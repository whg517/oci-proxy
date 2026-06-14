#!/usr/bin/env bash
# e2e/docker-hub/run.sh — Run all Docker Hub e2e tests
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

echo "============================================="
echo " e2e: Docker Hub Proxy Tests"
echo " Target: ${PROXY_URL}"
echo "============================================="
echo ""

for test in "${SCRIPT_DIR}"/[0-9]*.sh; do
  echo ">>> Running $(basename "$test")"
  bash "$test"
  echo ""
done

echo "============================================="
echo -e "${GREEN}All Docker Hub e2e tests passed!${NC}"
echo "============================================="
