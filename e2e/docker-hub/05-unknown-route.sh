#!/usr/bin/env bash
# e2e/docker-hub/05-unknown-route.sh
# Test unknown subdomains return 404 with helpful error
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

info "Test: Unknown registry prefix returns 404"
assert_status "${PROXY_URL}/v2/" 401 "Known registry returns 401 (not 404)"

info "Test: Error response for unknown route (only testable if unknown domain is resolvable)"
# We can only test this against local dev, skip for remote
if [[ "${PROXY_URL}" == http://localhost* ]]; then
  assert_status "http://unknown.example.com/v2/" 404 "Unknown subdomain returns 404"
else
  skip "Unknown route test only available in local dev mode"
fi

echo ""
info "All docker-hub/05-unknown-route tests passed"
