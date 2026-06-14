#!/usr/bin/env bash
# e2e/kind/02-pull-pod.sh
# Create pods that pull images through the proxy
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

CLUSTER_NAME="oci-proxy-e2e"
CTX="kind-${CLUSTER_NAME}"
NS="oci-proxy-e2e"

kubectl --context "${CTX}" create namespace "${NS}" 2>/dev/null || true

# Test images: small official images
TEST_IMAGES=(
  "nginx:alpine"
  "redis:alpine"
  "busybox:latest"
)

for image in "${TEST_IMAGES[@]}"; do
  pod_name="test-$(echo "$image" | tr '/:' '-')"
  info "Creating pod ${pod_name} with image ${image}..."

  kubectl --context "${CTX}" -n "${NS}" run "${pod_name}" \
    --image="${image}" \
    --command -- sleep 3600 2>/dev/null

  info "Waiting for pod ${pod_name} to be Running..."
  if kubectl --context "${CTX}" -n "${NS}" wait \
    --for=condition=Ready pod/"${pod_name}" \
    --timeout=180s 2>/dev/null; then
    ok "Pod ${pod_name} is Running (image: ${image})"
  else
    fail "Pod ${pod_name} failed to start (image: ${image})"
  fi

  # Verify image source
  IMAGE_ID=$(kubectl --context "${CTX}" -n "${NS}" get pod "${pod_name}" \
    -o jsonpath='{.status.containerStatuses[0].imageID}')
  if echo "$IMAGE_ID" | grep -q "docker.io"; then
    ok "Image source verified: ${IMAGE_ID}"
  else
    fail "Unexpected image source: ${IMAGE_ID}"
  fi
done
