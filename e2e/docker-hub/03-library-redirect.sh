#!/usr/bin/env bash
# e2e/docker-hub/03-library-redirect.sh
# Test official Docker Hub images get library/ prefix auto-inserted
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

info "Test: /v2/nginx/manifests/latest redirects to /v2/library/nginx/manifests/latest"
assert_redirect "${PROXY_URL}/v2/nginx/manifests/latest" "/v2/library/nginx/manifests/latest" "Official image gets library/ redirect"

info "Test: /v2/redis/manifests/alpine redirects to /v2/library/redis/manifests/alpine"
assert_redirect "${PROXY_URL}/v2/redis/manifests/alpine" "/v2/library/redis/manifests/alpine" "Official image gets library/ redirect"

info "Test: /v2/library/nginx/manifests/latest does NOT redirect (already has prefix)"
LOCATION=$(curl -s -o /dev/null -w "%{http_code}" "${PROXY_URL}/v2/library/nginx/manifests/latest")
# Should not be 301 (redirect), should be 401 (auth required) or 200 (with token)
if [ "$LOCATION" = "301" ]; then
  fail "Path with library/ prefix should not redirect, got 301"
else
  ok "Path with library/ prefix does not redirect (status ${LOCATION})"
fi

echo ""
info "All docker-hub/03-library-redirect tests passed"
