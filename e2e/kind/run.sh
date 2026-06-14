#!/usr/bin/env bash
# e2e/kind/run.sh — Run all kind cluster e2e tests
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

echo "============================================="
echo " e2e: Kind Cluster (K8s) Tests"
echo " Target: ${PROXY_URL}"
echo "============================================="
echo ""

for test in "${SCRIPT_DIR}"/[0-9]*.sh; do
  echo ">>> Running $(basename "$test")"
  bash "$test"
  echo ""
done

echo "============================================="
echo -e "${GREEN}All Kind e2e tests passed!${NC}"
echo "============================================="
