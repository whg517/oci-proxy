/**
 * oci-proxy - Cloudflare Worker for OCI container registry proxy
 *
 * Subdomain routing:
 *   docker.<domain> → registry-1.docker.io  (always enabled)
 *   ghcr.<domain>   → ghcr.io               (opt-in via REGISTRIES env)
 *   gcr.<domain>    → gcr.io                (opt-in via REGISTRIES env)
 *   k8s.<domain>    → registry.k8s.io       (opt-in via REGISTRIES env)
 *
 * All registries follow the standard OCI Distribution Spec auth flow:
 *   1. Client GET /v2/ → 401 with rewritten Www-Authenticate (realm → proxy)
 *   2. Client GET /v2/auth?scope=... → proxy resolves real realm from upstream, fetches token
 *   3. Client GET /v2/<image>/manifests/<ref> with Bearer token
 *   4. Client GET /v2/<image>/blobs/<digest> → 3xx redirect to CDN (followed manually)
 *
 * Docker Hub extra: official images without namespace get library/ prefix auto-inserted.
 *
 * Environment variables:
 *   REGISTRIES  - Comma-separated registry prefixes to enable (default: empty = only docker)
 *                 "docker" prefix is always enabled and cannot be disabled.
 */

// ─── Registry Route Table ──────────────────────────────────────────

const REGISTRY_TABLE: Record<string, string> = {
  docker: "https://registry-1.docker.io",
  ghcr: "https://ghcr.io",
  gcr: "https://gcr.io",
  "k8s": "https://registry.k8s.io",
};

const DEFAULT_REGISTRY = "docker";

// ─── Entry Point ───────────────────────────────────────────────────

interface Env {
  REGISTRIES?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.redirect(`${url.protocol}//${url.host}/v2/`, 301);
    }

    const prefix = resolvePrefix(url.hostname);
    if (!prefix || !(prefix in REGISTRY_TABLE)) {
      return jsonError(404, "Unknown registry", env);
    }

    // Whitelist check: docker always allowed, others need REGISTRIES env
    if (prefix !== DEFAULT_REGISTRY && !isEnabled(env, prefix)) {
      return jsonError(404, `Registry '${prefix}' is not enabled`, env);
    }

    const upstream = REGISTRY_TABLE[prefix];
    return handleRegistry(request, url, prefix, upstream);
  },
};

// ─── Unified Registry Handler ──────────────────────────────────────

async function handleRegistry(
  request: Request,
  url: URL,
  prefix: string,
  upstream: string,
): Promise<Response> {
  const authorization = request.headers.get("Authorization");

  // /v2/ — Registry API version check
  if (url.pathname === "/v2/") {
    const resp = await fetch(upstream + "/v2/", {
      headers: authorization ? { Authorization: authorization } : {},
      redirect: "follow",
    });
    if (resp.status === 401) {
      return buildUnauthorized(url);
    }
    return resp;
  }

  // /v2/auth — Token endpoint: resolve real realm from upstream, proxy token request
  if (url.pathname === "/v2/auth") {
    return handleAuth(url, upstream, authorization, prefix);
  }

  // Docker Hub: official images get library/ prefix auto-inserted
  if (prefix === "docker" && shouldInsertLibrary(url.pathname)) {
    const redirectUrl = new URL(url);
    redirectUrl.pathname = insertLibraryPrefix(redirectUrl.pathname);
    return Response.redirect(redirectUrl, 301);
  }

  // Forward request to upstream
  const targetUrl = new URL(url.pathname + url.search, upstream);
  const resp = await fetch(new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "manual",
  }));

  if (resp.status === 401) {
    return buildUnauthorized(url);
  }

  // Blob downloads: 3xx redirect to CDN — follow manually
  if (resp.status >= 300 && resp.status < 400) {
    const location = resp.headers.get("Location");
    if (location) {
      return fetch(location, { method: "GET", redirect: "follow" });
    }
  }

  return resp;
}

// ─── Auth Handler ──────────────────────────────────────────────────

/**
 * Resolve the real token endpoint from upstream's Www-Authenticate header,
 * then proxy the token request. Works for all OCI-compliant registries:
 *   Docker Hub: realm = https://auth.docker.io/token
 *   GHCR:       realm = https://ghcr.io/token
 *   GCR:        realm = https://gcr.io/v2/token
 *   k8s.io:     realm = https://registry.k8s.io/v2/token
 */
async function handleAuth(
  url: URL,
  upstream: string,
  authorization: string | null,
  prefix: string,
): Promise<Response> {
  const resp = await fetch(upstream + "/v2/", { redirect: "follow" });
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
    // Docker Hub: fix library scope (e.g., "repository:nginx:pull" → "repository:library/nginx:pull")
    tokenUrl.searchParams.set("scope", prefix === "docker" ? fixLibraryScope(scope) : scope);
  }

  const headers: HeadersInit = {};
  if (authorization) {
    headers["Authorization"] = authorization;
  }

  return fetch(tokenUrl.toString(), { method: "GET", headers });
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Extract subdomain prefix from hostname: "docker.example.com" → "docker" */
function resolvePrefix(hostname: string): string | null {
  const parts = hostname.split(".");
  if (parts.length < 2) return null;
  return parts[0];
}

/** Parse REGISTRIES env into a set of enabled prefixes (docker always included) */
function getEnabledPrefixes(env: Env): Set<string> {
  const enabled = new Set<string>([DEFAULT_REGISTRY]);
  if (env.REGISTRIES) {
    for (const r of env.REGISTRIES.split(",").map(s => s.trim()).filter(Boolean)) {
      enabled.add(r);
    }
  }
  return enabled;
}

function isEnabled(env: Env, prefix: string): boolean {
  return getEnabledPrefixes(env).has(prefix);
}

function jsonError(status: number, message: string, env: Env): Response {
  return new Response(
    JSON.stringify({ error: message, enabled: [...getEnabledPrefixes(env)] }, null, 2),
    { status, headers: { "Content-Type": "application/json" } },
  );
}

function buildUnauthorized(url: URL): Response {
  return new Response(JSON.stringify({ message: "UNAUTHORIZED" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Www-Authenticate": `Bearer realm="https://${url.hostname}/v2/auth",service="${url.hostname}"`,
    },
  });
}

function parseWwwAuthenticate(header: string): { realm: string; service: string } {
  const result: Record<string, string> = {};
  // Match both quoted (key="value") and unquoted (key=value) parameters.
  // GCR returns service=gcr.io without quotes, while most registries use quotes.
  const re = /(\w+)="([^"]+)"|(\w+)=([^,]+)/g;
  let match;
  while ((match = re.exec(header)) !== null) {
    const key = match[1] || match[3];
    const value = (match[2] || match[4] || "").trim();
    result[key] = value;
  }
  return { realm: result["realm"] || "", service: result["service"] || "" };
}

// ─── Docker Hub Library Image Helpers ──────────────────────────────

/** Check if path needs library/ prefix: /v2/nginx/manifests/latest → true */
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

/** Insert library/ prefix: /v2/nginx/manifests/latest → /v2/library/nginx/manifests/latest */
function insertLibraryPrefix(pathname: string): string {
  const parts = pathname.split("/");
  parts.splice(2, 0, "library");
  return parts.join("/");
}

/** Fix scope for library images: repository:nginx:pull → repository:library/nginx:pull */
function fixLibraryScope(scope: string): string {
  const parts = scope.split(":");
  if (parts.length === 3 && !parts[1].includes("/")) {
    parts[1] = "library/" + parts[1];
  }
  return parts.join(":");
}
