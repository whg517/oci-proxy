/**
 * oci-proxy - Cloudflare Worker for OCI container registry proxy
 *
 * Phase 1: Docker Hub proxy
 *   docker.example.com → registry-1.docker.io
 *
 * Future registries (subdomain routing):
 *   ghcr.example.com → ghcr.io
 *   gcr.example.com  → gcr.io
 *   k8s.example.com  → registry.k8s.io
 *
 * Architecture:
 *   1. Route by incoming Host header (subdomain prefix → upstream registry)
 *   2. For Docker Hub: rewrite Www-Authenticate realm to proxy auth endpoint,
 *      handle library image redirects, and manually follow blob 307 redirects
 *   3. For other registries: generic passthrough (future)
 */

// ─── Route Configuration ────────────────────────────────────────────

const DOCKER_HUB = "https://registry-1.docker.io";

/** subdomain prefix → upstream registry URL */
const ROUTES: Record<string, string> = {
  "docker.": DOCKER_HUB,
  // Future:
  // "ghcr.": "https://ghcr.io",
  // "gcr.": "https://gcr.io",
  // "k8s.": "https://registry.k8s.io",
};

// ─── Entry Point ──────────────────────────────────────────────────

export default {
  async fetch(request: Request, _env: {}, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Root → redirect to /v2/ (registry API version check)
    if (url.pathname === "/") {
      return Response.redirect(`${url.protocol}//${url.host}/v2/`, 301);
    }

    // Resolve upstream from hostname
    const upstream = resolveUpstream(url.hostname);
    if (!upstream) {
      return new Response(
        JSON.stringify({ error: "Unknown registry", available_routes: ROUTES }, null, 2),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }

    // Docker Hub: special auth + redirect handling
    if (upstream === DOCKER_HUB) {
      return handleDockerHub(request, url);
    }

    // Other registries: generic passthrough (future)
    return genericProxy(request, upstream);
  },
};

// ─── Upstream Resolution ──────────────────────────────────────────

function resolveUpstream(hostname: string): string | undefined {
  for (const [prefix, target] of Object.entries(ROUTES)) {
    // Match "docker.example.com" against prefix "docker."
    if (hostname.startsWith(prefix)) {
      return target;
    }
  }
  return undefined;
}

// ─── Docker Hub Handler ───────────────────────────────────────────
//
// Docker Hub auth flow:
//   1. Client GET /v2/ → 401 with Www-Authenticate header
//   2. Client GET /v2/auth?scope=... → proxy to auth.docker.io/token?...
//   3. Client GET /v2/<image>/manifests/<ref> with Bearer token
//   4. Client GET /v2/<image>/blobs/<digest> with Bearer token (307 → CDN)

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
  // Docker daemon sends "nginx" without "library/" prefix for official images
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
    redirect: "manual", // Don't auto-follow Docker Hub blob 307 redirects
  }));

  // Rewrite 401 auth challenge to point back to our proxy
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
  // Get the real auth challenge from Docker Hub
  const resp = await fetch(DOCKER_HUB + "/v2/", { redirect: "follow" });
  if (resp.status !== 401 || !resp.headers.get("WWW-Authenticate")) {
    return resp;
  }

  const { realm, service } = parseWwwAuthenticate(resp.headers.get("WWW-Authenticate")!);

  const tokenUrl = new URL(realm);
  if (service) {
    tokenUrl.searchParams.set("service", service);
  }

  // Pass through scope from client, fixing library prefix if needed
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

/** Build a 401 response with Www-Authenticate pointing to our proxy's auth endpoint */
function buildUnauthorized(url: URL): Response {
  return new Response(JSON.stringify({ message: "UNAUTHORIZED" }), {
    status: 401,
    headers: {
      "Content-Type": "application/json",
      "Www-Authenticate": `Bearer realm="https://${url.hostname}/v2/auth",service="cloudflare-docker-proxy"`,
    },
  });
}

/** Parse Www-Authenticate header: Bearer realm="...",service="..." */
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

/**
 * Check if the path needs "library/" inserted.
 * Official images like nginx are requested as /v2/nginx/manifests/latest
 * but Docker Hub expects /v2/library/nginx/manifests/latest.
 *
 * Path structure:
 *   /v2/nginx/manifests/latest    → 5 parts → needs library/
 *   /v2/library/nginx/manifests/ → 6 parts → already has library/
 *   /v2/myuser/myimage/manifests → 6 parts → namespaced, no library/
 */
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

/** Insert "library" at position 2: /v2/nginx/... → /v2/library/nginx/... */
function insertLibraryPrefix(pathname: string): string {
  const parts = pathname.split("/");
  parts.splice(2, 0, "library");
  return parts.join("/");
}

/**
 * Fix auth scope for library images.
 * Docker daemon sends scope="repository:nginx:pull" for official images,
 * but Docker Hub expects scope="repository:library/nginx:pull".
 */
function fixLibraryScope(scope: string): string {
  const parts = scope.split(":");
  if (parts.length === 3 && !parts[1].includes("/")) {
    parts[1] = "library/" + parts[1];
  }
  return parts.join(":");
}

// ─── Generic Proxy (for future registries) ────────────────────────

async function genericProxy(request: Request, upstream: string): Promise<Response> {
  const url = new URL(request.url);
  const targetUrl = new URL(url.pathname + url.search, upstream);
  return fetch(new Request(targetUrl.toString(), {
    method: request.method,
    headers: request.headers,
    redirect: "follow",
  }));
}
