#!/usr/bin/env bash
# e2e/docker-hub/01-api-version.sh
# Test /v2/ endpoint returns 401 with correct Www-Authenticate header
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

info "Test: /v2/ returns 401"
assert_status "${PROXY_URL}/v2/" 401 "GET /v2/ should return 401 Unauthorized"

info "Test: Www-Authenticate header points to proxy auth endpoint"
assert_header "${PROXY_URL}/v2/" "www-authenticate" "Bearer realm=\"https://${PROXY_URL#https://}" "Www-Authenticate realm points to proxy"

info "Test: Www-Authenticate service is set"
assert_header "${PROXY_URL}/v2/" "www-authenticate" "service=" "Www-Authenticate has service field"

info "Test: Root / redirects to /v2/"
assert_redirect "${PROXY_URL}/" "/v2/" "Root redirects to /v2/"

echo ""
info "All docker-hub/01-api-version tests passed"
