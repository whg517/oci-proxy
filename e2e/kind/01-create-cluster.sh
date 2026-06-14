#!/usr/bin/env bash
# e2e/kind/01-create-cluster.sh
# Create a kind cluster with containerd mirror pointing to the proxy
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

CLUSTER_NAME="oci-proxy-e2e"

# Extract registry host from PROXY_URL
REGISTRY="${PROXY_URL#https://}"

info "Creating kind cluster '${CLUSTER_NAME}' with mirror config..."

# Generate kind config with the actual proxy URL
KIND_CONFIG=$(mktemp)
trap "rm -f ${KIND_CONFIG}" EXIT

cat > "${KIND_CONFIG}" << EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: ${CLUSTER_NAME}
containerdConfigPatches:
  - |-
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
        endpoint = ["${PROXY_URL}"]
EOF

if kind create cluster --config "${KIND_CONFIG}" 2>&1; then
  ok "Kind cluster '${CLUSTER_NAME}' created"
else
  # Cluster might already exist, try to use it
  if kind get clusters | grep -q "${CLUSTER_NAME}"; then
    skip "Kind cluster '${CLUSTER_NAME}' already exists, reusing"
  else
    fail "Failed to create kind cluster"
  fi
fi

info "Waiting for control-plane node to be ready..."
kubectl --context "kind-${CLUSTER_NAME}" wait \
  --for=condition=Ready node/"${CLUSTER_NAME}-control-plane" \
  --timeout=120s

ok "Node is Ready"

# Verify mirror config is in place
MIRROR=$(docker exec "${CLUSTER_NAME}-control-plane" \
  grep -A 2 "registry.mirrors.*docker.io" /etc/containerd/config.toml)
if echo "$MIRROR" | grep -q "$REGISTRY"; then
  ok "Containerd mirror config verified: docker.io → ${PROXY_URL}"
else
  fail "Containerd mirror config not found"
fi
