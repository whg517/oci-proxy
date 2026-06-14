#!/usr/bin/env bash
# e2e/run.sh — Run all e2e test scenarios
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

SCENARIOS="${1:-all}"

echo "============================================="
echo " e2e Test Suite — oci-proxy"
echo " Proxy: ${PROXY_URL}"
echo "============================================="
echo ""

run_scenario() {
  local name="$1"
  local dir="${SCRIPT_DIR}/${name}"
  if [ -f "${dir}/run.sh" ]; then
    bash "${dir}/run.sh"
  else
    fail "No run.sh found in ${dir}"
  fi
}

case "${SCENARIOS}" in
  all)
    for dir in "${SCRIPT_DIR}"/*/; do
      [ -f "${dir}/run.sh" ] && run_scenario "$(basename "${dir}")"
    done
    ;;
  docker-hub|kind)
    run_scenario "${SCENARIOS}"
    ;;
  *)
    echo "Usage: $0 [all|docker-hub|kind]"
    exit 1
    ;;
esac

echo ""
echo "============================================="
echo -e "${GREEN}All e2e tests passed!${NC}"
echo "============================================="
