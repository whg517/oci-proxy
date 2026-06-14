#!/usr/bin/env bash
# e2e/lib.sh — Common helper functions for e2e tests
set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PROXY_URL="${PROXY_URL:-https://docker.mwh122.com}"

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[PASS]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; exit 1; }
skip()  { echo -e "${YELLOW}[SKIP]${NC}  $*"; }

# Assert HTTP status code equals expected
assert_status() {
  local url="$1" expected="$2" desc="$3"
  local actual
  actual=$(curl -s -o /dev/null -w "%{http_code}" "${url}")
  if [ "$actual" = "$expected" ]; then
    ok "${desc} (status ${actual})"
  else
    fail "${desc}: expected status ${expected}, got ${actual}"
  fi
}

# Assert response body contains a string
assert_contains() {
  local url="$1" expected="$2" desc="$3"
  local body
  body=$(curl -s "${url}")
  if echo "$body" | grep -q "$expected"; then
    ok "${desc}"
  else
    fail "${desc}: response does not contain '${expected}'"
  fi
}

# Assert HTTP header contains expected value
assert_header() {
  local url="$1" header="$2" expected="$3" desc="$4"
  local value
  value=$(curl -s -I "${url}" | grep -i "^${header}:" | head -1)
  if echo "$value" | grep -qi "$expected"; then
    ok "${desc}"
  else
    fail "${desc}: header '${header}' does not contain '${expected}', got '${value}'"
  fi
}

# Assert HTTP redirect location
assert_redirect() {
  local url="$1" expected_path="$2" desc="$3"
  local location
  location=$(curl -s -o /dev/null -w "%{redirect_url}" "${url}")
  if echo "$location" | grep -q "$expected_path"; then
    ok "${desc} (→ ${location})"
  else
    fail "${desc}: expected redirect to contain '${expected_path}', got '${location}'"
  fi
}
