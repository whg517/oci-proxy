/**
 * oci-proxy - Cloudflare Worker for OCI container registry proxy
 *
 * Subdomain routing:
 *   docker.<domain> → registry-1.docker.io  (always enabled)
 *   ghcr.<domain>   → ghcr.io               (opt-in via REGISTRIES env)
 *   gcr.<domain>    → gcr.io                (opt-in via REGISTRIES env)
 *   k8s.<domain>    → registry.k8s.io       (opt-in via REGISTRIES env)
 *
 * Environment variables (set via wrangler.toml or Cloudflare Dashboard):
 *   REGISTRIES  - Comma-separated registry prefixes to enable (default: empty = only docker)
 *                 Example: "ghcr,gcr,k8s" enables ghcr.<domain>, gcr.<domain>, k8s.<domain>
 *                 "docker" prefix is always enabled and cannot be disabled.
 *
 * Deployment:
 *   1. Set REGISTRIES env var in wrangler.toml or Cloudflare Dashboard
 *   2. Add Cloudflare Routes / Custom Domains for each subdomain
 *   3. Add DNS records for each subdomain pointing to the Worker
 *   4. No code changes needed — just config + DNS
 */

// ─── Built-in Registry Route Table ─────────────────────────────────
// prefix → upstream registry URL
// "docker" is always enabled; others require REGISTRIES env var

const REGISTRY_TABLE: Record<string, string> = {
  docker: "https://registry-1.docker.io",
  ghcr: "https://ghcr.io",
  gcr: "https://gcr.io",
  "k8s": "https://registry.k8s.io",
};

const DEFAULT_REGISTRY = "docker";

// ─── Entry Point ──────────────────────────────────────────────────

interface Env {
  REGISTRIES?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(`${url.protocol}//${url.host}/v2/`, 301);
    }

    // Resolve: extract subdomain prefix from hostname
    const prefix = resolvePrefix(url.hostname);
    if (!prefix) {
      return new Response(
        JSON.stringify({
          error: "Unknown registry",
          enabled: listEnabledRegistries(env),
        }, null, 2),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    const upstream = REGISTRY_TABLE[prefix];
    if (!upstream) {
      return new Response(
        JSON.stringify({
          error: "Unsupported registry prefix",
          prefix,
          enabled: listEnabledRegistries(env),
        }, null, 2),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Docker Hub: special auth + redirect + blob handling
    if (prefix === "docker") {
      return handleDockerHub(request, url);
    }

    // Other registries: generic passthrough
    return genericProxy(request, upstream);
  },
};

// ─── Prefix Resolution ───────────────────────────────────────────

/** Extract subdomain prefix from hostname: "docker.example.com" → "docker" */
function resolvePrefix(hostname: string): string | null {
  const parts = hostname.split(".");
  if (parts.length < 2) return null;
  return parts[0];
}

/** Parse REGISTRIES env into a set of enabled prefixes (docker is always included) */
function getEnabledPrefixes(env: Env): Set<string> {
  const enabled = new Set<string>([DEFAULT_REGISTRY]);
  if (env.REGISTRIES) {
    for (const r of env.REGISTRIES.split(",").map(s => s.trim()).filter(Boolean)) {
      enabled.add(r);
    }
  }
  return enabled;
}

/** Check if a prefix is enabled */
function isEnabled(env: Env, prefix: string): boolean {
  return getEnabledPrefixes(env).has(prefix);
}

/** List enabled registries for error responses */
function listEnabledRegistries(env: Env): string[] {
  const enabled: string[] = [];
  for (const prefix of getEnabledPrefixes(env)) {
    const upstream = REGISTRY_TABLE[prefix];
    if (upstream) {
      enabled.push(`${prefix}.${prefix === DEFAULT_REGISTRY ? "<domain>" : "<domain>"} → ${upstream}`);
    }
  }
  return enabled;
}

// ─── Docker Hub Handler ───────────────────────────────────────────
//
// Docker Hub auth flow:
//   1. Client GET /v2/ → 401 with Www-Authenticate header
//   2. Client GET /v2/auth?scope=... → proxy to auth.docker.io/token?...
//   3. Client GET /v2/<image>/manifests/<ref> with Bearer token
//   4. Client GET /v2/<image>/blobs/<digest> with Bearer token (307 → CDN)

const DOCKER_HUB = REGISTRY_TABLE.docker;

async function handleDockerHub(request: Request, url: URL): Promise<Response> {
  const authorization = request.headers.get("Authorization");

  // /v2/ — Registry API version check
  if (url.pathname === "/v2/") {
    const resp = await fetch(DOCKER_HUB + "/v2/", {
      headers: authorization ? { Authorization: authorization } : {},
      redirect: "follow",
    });
    if (resp.status === 401) {
      return buildUnauthorized(url);
    }
    return resp;
  }

  // /v2/auth — Token endpoint: proxy to auth.docker.io
  if (url.pathname === "/v2/auth") {
    return handleDockerHubAuth(url, authorization);
  }

  // Docker Hub library images: /v2/<image>/... → /v2/library/<image>/...
  if (shouldInsertLibrary(url.pathname)) {
    const redirectUrl = new URL(url);
    redirectUrl.pathname = insertLibraryPrefix(redirectUrl.pathname);
    return Response.redirect(redirectUrl, 301);
  }

  // Forward all other requests to Docker Hub
  const targetUrl = new URL(url.pathname + url.search, DOCKER_HUB);
  const resp = await fetch(new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
  }));

  if (resp.status === 401) {
    return buildUnauthorized(url);
  }

  // Docker Hub blobs return 307 redirect to CDN — follow manually
  if (resp.status === 307) {
    const location = resp.headers.get("Location");
    if (location) {
      return fetch(location, { method: "GET", redirect: "follow" });
    }
  }

  return resp;
}

/**
 * Proxy /v2/auth requests to Docker Hub's real auth endpoint (auth.docker.io).
 * Fixes the scope for library images (e.g., "nginx" → "library/nginx").
 */
async function handleDockerHubAuth(url: URL, authorization: string | null): Promise<Response> {
  const resp = await fetch(DOCKER_HUB + "/v2/", { redirect: "follow" });
  if (resp.status !== 401 || !resp.headers.get("WWW-Authenticate")) {
    return resp;
  }

  const { realm, service } = parseWwwAuthenticate(resp.headers.get("WWW-Authenticate")!);

  const tokenUrl = new URL(realm);
  if (service) {
    tokenUrl.searchParams.set("service", service);
  }

  const scope = url.searchParams.get("scope");
  if (scope) {
    tokenUrl.searchParams.set("scope", fixLibraryScope(scope));
  }

  const headers: HeadersInit = {};
  if (authorization) {
    headers["Authorization"] = authorization;
  }

  return fetch(tokenUrl.toString(), { method: "GET", headers });
}

// ─── Auth Helpers ─────────────────────────────────────────────────

function buildUnauthorized(url: URL): Response {
  return new Response(JSON.stringify({ message: "UNAUTHORIZED" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Www-Authenticate": `Bearer realm="https://${url.hostname}/v2/auth",service="cloudflare-docker-proxy"`,
    },
  });
}

function parseWwwAuthenticate(header: string): { realm: string; service: string } {
  const result: Record<string, string> = {};
  const re = /(\w+)="([^"]+)"/g;
  let match;
  while ((match = re.exec(header)) !== null) {
    result[match[1]] = match[2];
  }
  return { realm: result["realm"] || "", service: result["service"] || "" };
}

// ─── Docker Hub Library Image Helpers ─────────────────────────────

function shouldInsertLibrary(pathname: string): boolean {
  const parts = pathname.split("/");
  return (
    parts.length === 5 &&
    parts[1] === "v2" &&
    parts[2] !== "" &&
    parts[3] !== "" &&
    !parts[2].includes("/")
  );
}

function insertLibraryPrefix(pathname: string): string {
  const parts = pathname.split("/");
  parts.splice(2, 0, "library");
  return parts.join("/");
}

function fixLibraryScope(scope: string): string {
  const parts = scope.split(":");
  if (parts.length === 3 && !parts[1].includes("/")) {
    parts[1] = "library/" + parts[1];
  }
  return parts.join(":");
}

// ─── Generic Proxy ─────────────────────────────────────────────────

async function genericProxy(request: Request, upstream: string): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = new URL(url.pathname + url.search, upstream);
  return fetch(new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  }));
}
