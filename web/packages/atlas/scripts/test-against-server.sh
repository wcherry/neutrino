#!/usr/bin/env bash
# Runs the package's server integration tests (driveIntegration.test.ts) against a real Neutrino
# server: builds this repo's server, starts it on a free port with a throwaway database and
# storage, runs the tests with ATLAS_TEST_SERVER set, and stops it. The same harness as
# neutrino_atlaskit's scripts/test-against-server.sh.
#
#   web/packages/atlas/scripts/test-against-server.sh
#   ATLAS_TEST_SERVER=http://localhost:8080 NEXT_PUBLIC_API_URL=http://localhost:8080 \
#     npx vitest run packages/atlas/src/__tests__/driveIntegration.test.ts   # your own server, from web/
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../../.." && pwd)"

(cd "$repo" && cargo build --quiet --bin neutrino)

work="$(mktemp -d)"
mkdir -p "$work/storage"
port="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
url="http://localhost:$port"

PORT="$port" JWT_SECRET="$(openssl rand -hex 32)" WORKER_SECRET="$(openssl rand -hex 32)" \
  DATABASE_URL="$work/neutrino.db" STORAGE_PATH="$work/storage" MAIL_TRANSPORT=outbox DRIVE_URL="$url" \
  "${CARGO_TARGET_DIR:-$repo/target}/debug/neutrino" > "$work/server.log" 2>&1 &
pid=$!
trap 'kill $pid 2>/dev/null || true; wait $pid 2>/dev/null || true; rm -rf "$work"' EXIT

for _ in $(seq 120); do
  curl -fs "$url/health" > /dev/null && break
  kill -0 $pid 2>/dev/null || { cat "$work/server.log" >&2; exit 1; }
  sleep 0.5
done
curl -fs "$url/health" > /dev/null || { echo "server didn't start" >&2; tail -50 "$work/server.log" >&2; exit 1; }

cd "$repo/web"
ATLAS_TEST_SERVER="$url" NEXT_PUBLIC_API_URL="$url" npx vitest run packages/atlas/src/__tests__/driveIntegration.test.ts "$@"
