#!/usr/bin/env bash
# e2e/kind/03-cleanup.sh
# Clean up e2e test resources
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "${SCRIPT_DIR}/../lib.sh"

CLUSTER_NAME="oci-proxy-e2e"
CTX="kind-${CLUSTER_NAME}"
NS="oci-proxy-e2e"

# Clean up test namespace
if kubectl --context "${CTX}" get namespace "${NS}" 2>/dev/null; then
  info "Deleting namespace ${NS}..."
  kubectl --context "${CTX}" delete namespace "${NS}" --wait=false 2>/dev/null || true
  ok "Namespace ${NS} deleted"
fi

# Delete kind cluster
if kind get clusters 2>/dev/null | grep -q "${CLUSTER_NAME}"; then
  info "Deleting kind cluster '${CLUSTER_NAME}'..."
  kind delete cluster --name "${CLUSTER_NAME}" 2>/dev/null
  ok "Kind cluster '${CLUSTER_NAME}' deleted"
else
  skip "Kind cluster '${CLUSTER_NAME}' does not exist"
fi
