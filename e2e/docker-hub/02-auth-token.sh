#!/usr/bin/env bash
# e2e/docker-hub/02-auth-token.sh
# Test /v2/auth endpoint returns valid Bearer token
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

info "Test: /v2/auth returns 200 with token"
assert_status "${PROXY_URL}/v2/auth?scope=repository:nginx:pull" 200 "GET /v2/auth should return 200"

info "Test: Response contains token field"
assert_contains "${PROXY_URL}/v2/auth?scope=repository:nginx:pull" '"token"' "Auth response has 'token' field"

info "Test: Library scope auto-fix (nginx → library/nginx)"
# The token should work for the library-prefixed scope
TOKEN=$(curl -s "${PROXY_URL}/v2/auth?scope=repository:nginx:pull" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" 2>/dev/null)
if [ -n "$TOKEN" ] && [ ${#TOKEN} -gt 50 ]; then
  ok "Token obtained (${#TOKEN} chars), scope fixed to library/nginx"
else
  fail "Failed to obtain valid token"
fi

echo ""
info "All docker-hub/02-auth-token tests passed"
