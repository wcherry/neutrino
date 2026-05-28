#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NEUTRINO_ROOT="$(cd "${REPO_ROOT}/.." && pwd)"

GHCR_OWNER="${GHCR_OWNER:-wcherry}"
SKIP_BUILD=false

for arg in "$@"; do
  case "$arg" in
    --skip-build) SKIP_BUILD=true ;;
  esac
done

if [ "$SKIP_BUILD" = "true" ]; then
  echo "Skipping image build (--skip-build)"
  exit 0
fi

IMAGE="neutrino:test"

# Build or pull the single neutrino image
if [ -f "${NEUTRINO_ROOT}/Dockerfile" ]; then
  echo ""
  echo "=== Building neutrino from local source ==="
  # docker build --no-cache -t "$IMAGE" "$NEUTRINO_ROOT"
  docker build -t "$IMAGE" "$NEUTRINO_ROOT"
else
  echo ""
  echo "=== Local Dockerfile not found — pulling from GHCR ==="
  REMOTE_IMAGE="ghcr.io/${GHCR_OWNER}/neutrino:latest"
  docker pull "$REMOTE_IMAGE"
  docker tag "$REMOTE_IMAGE" "$IMAGE"
  echo "Tagged ${REMOTE_IMAGE} as ${IMAGE}"
fi

echo ""
echo "Image ready: ${IMAGE}"
