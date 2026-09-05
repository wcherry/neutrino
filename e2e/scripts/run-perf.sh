#!/usr/bin/env bash
#
# Run the performance suite.
#
# Mirrors run-tests.sh — same Docker stack, same RUN_DIR artifact layout — and
# adds what a perf run needs on top: PERF=1 to select the perf project, and a
# markdown summary written from perf-results.json when the run finishes.
#
#   ./scripts/run-perf.sh                          # full run, 5 repeats
#   ./scripts/run-perf.sh --skip-build             # reuse the :test images
#   ./scripts/run-perf.sh --grep "D3"              # one scenario
#   PERF_TRACE=1 ./scripts/run-perf.sh --grep "D3" # + a Chrome trace
#   ./scripts/run-perf.sh --write-baselines        # phase 3: seed the ratchet
#   ./scripts/run-perf.sh --update-baselines       # ratchet down on improvement
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cleanup() {
  echo ""
  echo "Interrupted — tearing down Docker stack..."
  docker compose -f "${REPO_ROOT}/docker-compose-test.yml" down 2>/dev/null || true
  exit 130
}
trap cleanup INT TERM

RUN_ID="$(date +%Y%m%d_%H%M%S)_$(openssl rand -hex 4)"
BASE_DIR="${NEUTRINO_E2E_BASE_DIR:-/tmp/neutrino-e2e}"
export RUN_DIR="${BASE_DIR}/${RUN_ID}"
export PERF=1

echo "Run ID  : ${RUN_ID}"
echo "Run dir : ${RUN_DIR}"
echo "Scale   : ${PERF_SCALE:-default}   CPU throttle: ${PERF_CPU_THROTTLE:-4}x   repeats: ${PERF_REPEATS:-5}"
echo ""

mkdir -p \
  "${RUN_DIR}/data" \
  "${RUN_DIR}/data/storage" \
  "${RUN_DIR}/service-logs" \
  "${RUN_DIR}/browser-logs" \
  "${RUN_DIR}/databases" \
  "${RUN_DIR}/perf" \
  "${RUN_DIR}/playwright-artifacts" \
  "${RUN_DIR}/playwright-report"

BUILD_ARGS=()
PW_ARGS=()
BASELINE_MODE=""
for arg in "$@"; do
  case "$arg" in
    --skip-build) BUILD_ARGS+=("$arg") ;;
    --write-baselines) BASELINE_MODE="--write" ;;
    --update-baselines) BASELINE_MODE="--update" ;;
    *) PW_ARGS+=("$arg") ;;
  esac
done

"${SCRIPT_DIR}/build-images.sh" "${BUILD_ARGS[@]+"${BUILD_ARGS[@]}"}"

cd "$REPO_ROOT"
EXIT_CODE=0
pnpm exec playwright test "${PW_ARGS[@]+"${PW_ARGS[@]}"}" || EXIT_CODE=$?

# The summary is written even when the run failed: a suite that fell over in
# scenario 40 still measured 39, and those numbers are the reason to look.
if [ -f "${RUN_DIR}/perf/perf-results.json" ]; then
  echo ""
  pnpm exec tsx perf/report/summarize.ts ${BASELINE_MODE:+"$BASELINE_MODE"}
else
  echo ""
  echo "No perf-results.json was written — nothing to summarise."
fi

echo ""
echo "Run artifacts saved to: ${RUN_DIR}"
echo "  Perf results : ${RUN_DIR}/perf/perf-results.json"
echo "  Perf summary : ${RUN_DIR}/perf/perf-summary.md"
echo "  Traces       : ${RUN_DIR}/perf/traces/  (PERF_TRACE=1 only)"
echo "  Service logs : ${RUN_DIR}/service-logs/"
echo "  Browser logs : ${RUN_DIR}/browser-logs/"

exit $EXIT_CODE
