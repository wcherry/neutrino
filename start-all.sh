#!/bin/bash
# Runs the API server and the background worker together in one container.
#
# This is the image's default command. Both processes are needed for a complete
# install — face detection, account purging and file-version retention all live
# in the worker — and running them as two containers means keeping two sets of
# environment variables and one shared volume in step by hand.
#
# It is deliberately not a supervisor. There are exactly two processes, neither
# restarts on its own, and the container exits as soon as either one does: a
# server running without its worker looks healthy while quietly doing none of
# the background work, which is the failure this must not hide. Let the
# orchestrator restart the container — that is what its restart policy is for.
#
# To run just one of them (the two-container layout, still supported), override
# the command: `docker run … neutrino /usr/local/bin/worker`.

set -uo pipefail

SERVICE_BIN=${SERVICE_BIN:-/usr/local/bin/service}
WORKER_BIN=${WORKER_BIN:-/usr/local/bin/worker}

# How long to wait for the server to answer /health before starting the worker
# anyway. The wait exists because the server is what runs the database
# migrations: a worker that opens the file first finds tables that do not exist
# yet, and its sweeps are on an hourly timer, so it would sit idle for an hour
# over a race that lasts a second. Bounded rather than indefinite — if the
# server never becomes healthy the worker should still be running and logging,
# not silently absent.
READY_TIMEOUT_SECS=${READY_TIMEOUT_SECS:-60}

service_pid=""
worker_pid=""

# Forward a stop to both children rather than dying and orphaning them; without
# this, `docker stop` would wait out its grace period and SIGKILL the lot,
# cutting the worker mid-job and losing whatever the log writers still held.
shutdown() {
    trap - TERM INT
    [ -n "$service_pid" ] && kill -TERM "$service_pid" 2>/dev/null
    [ -n "$worker_pid" ] && kill -TERM "$worker_pid" 2>/dev/null
    wait
    exit 0
}
trap shutdown TERM INT

"$SERVICE_BIN" &
service_pid=$!

# Poll /health until it answers, the timeout runs out, or the server exits.
deadline=$((SECONDS + READY_TIMEOUT_SECS))
while [ "$SECONDS" -lt "$deadline" ]; do
    if ! kill -0 "$service_pid" 2>/dev/null; then
        echo "start-all: server exited before becoming ready" >&2
        wait "$service_pid"
        exit $?
    fi
    if curl -fsS -o /dev/null "http://127.0.0.1:${PORT:-8080}/health" 2>/dev/null; then
        break
    fi
    sleep 1
done

"$WORKER_BIN" &
worker_pid=$!

# Whichever exits first ends the container, carrying its status out with it.
wait -n "$service_pid" "$worker_pid"
status=$?

if kill -0 "$service_pid" 2>/dev/null; then
    echo "start-all: worker exited (status $status), stopping the server" >&2
else
    echo "start-all: server exited (status $status), stopping the worker" >&2
fi

kill -TERM "$service_pid" "$worker_pid" 2>/dev/null
wait
exit "$status"
