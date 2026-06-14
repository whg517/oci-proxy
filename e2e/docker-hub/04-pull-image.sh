#!/usr/bin/env bash
# e2e/docker-hub/04-pull-image.sh
# Test docker pull images through the proxy
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

# Extract registry host from PROXY_URL
REGISTRY="${PROXY_URL#https://}"

pull_image() {
  local image="$1"
  local full="${REGISTRY}/library/${image}"
  info "Pull ${full}"
  if docker pull "${full}" > /dev/null 2>&1; then
    ok "Pulled ${image}"
  else
    fail "Failed to pull ${image}"
  fi
  # Clean up
  docker rmi "${full}" > /dev/null 2>&1 || true
}

pull_image "nginx:alpine"
pull_image "redis:alpine"
pull_image "busybox:latest"

echo ""
info "All docker-hub/04-pull-image tests passed"
