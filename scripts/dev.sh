#!/usr/bin/env bash
#
# Dev orchestrator. `pnpm -r --parallel dev` forwards signals unreliably on
# macOS -- `tsx watch` ends up orphaned when the terminal sends SIGINT,
# which then holds port 3000 hostage the next time the dev server starts.
#
# Running the filters as backgrounded children of *this* shell puts them in
# the same process group, and `kill 0` on trap tears the whole group down
# (server, web, and any grandchildren tsx spawns).

set -u

cleanup() {
  trap - EXIT INT TERM HUP
  # Send SIGTERM to every process in this shell's group, including grandchildren.
  kill -TERM 0 2>/dev/null || true
  # Give the server time to run its full graceful shutdown (PTY teardown,
  # state flush, IPC stop, mode-marker release). 0.3s used to be enough but
  # SIGKILL'd the server mid-`releaseModeMarker()`, leaking
  # `appstate.mode.lock/` and forcing the next start to wait 60s for the
  # proper-lockfile stale window. Poll for ≤5s, then escalate.
  local waited=0
  while [ "$waited" -lt 50 ]; do
    pgrep -g 0 -f 'tsx.*src/index.ts' >/dev/null 2>&1 || break
    sleep 0.1
    waited=$((waited + 1))
  done
  kill -KILL 0 2>/dev/null || true
}
trap cleanup EXIT INT TERM HUP

# Default dev config dir: isolated from an installed production parasor that
# uses ~/.config/parasor. Respect an explicit override.
export PARASOR_CONFIG_DIR="${PARASOR_CONFIG_DIR:-/tmp/parasor-dev}"
mkdir -p "$PARASOR_CONFIG_DIR"

# Default dev port: isolated from the production default of 7681.
# Without this, dev and prod race for the same port on the same host -- whichever
# starts first wins, the other silently auto-bumps, and the web UI may end up
# proxying to the wrong backend. Respect an explicit override.
export PORT="${PORT:-7682}"
export WEB_PORT="${WEB_PORT:-7683}"

# Terminal tracing is opt-in. Set PARASOR_TERMINAL_TRACE=1 when collecting
# diagnostics via /api/debug/terminal-trace.

# Force in-process PTY mode for dev: production foreground parasor defaults to
# daemon mode (so npm-update / server-restart preserve sessions), but the dev
# tsx-watch loop reloads the server process every code change. Letting that
# server spawn a detached daemon would (a) collide with the production
# `~/.parasor/run/parasor-pty.sock` (PARASOR_CONFIG_DIR isolates state.json
# only, NOT the daemon socket path), and (b) leave a daemon still running
# under stale code. Pin to in-process so dev sessions live and die with the
# tsx-watch process. Override by exporting PARASOR_PTY_DAEMON=1 if you need
# to test the daemon path locally (set PARASOR_PTY_SOCK too).
export PARASOR_PTY_DAEMON="${PARASOR_PTY_DAEMON:-0}"

CONFIG_DIR="$PARASOR_CONFIG_DIR"
RUNTIME_FILE="$CONFIG_DIR/runtime.json"
PREV_RUNTIME="$(cat "$RUNTIME_FILE" 2>/dev/null || true)"

# Always start from a clean slate in this config dir in case a previous run was
# killed hard. Do not pkill other dev profiles: separate PORT / WEB_PORT /
# PARASOR_CONFIG_DIR stacks should be able to run side by side.
rm -rf \
  "$CONFIG_DIR/parasor.lock" \
  "$CONFIG_DIR/parasor.sock" \
  "$CONFIG_DIR/parasor.lock.lock" \
  "$CONFIG_DIR/appstate.mode" \
  "$CONFIG_DIR/appstate.mode.lock" \
  >/dev/null 2>&1 || true

wait_for_runtime() {
  local attempts=0
  while [ "$attempts" -lt 150 ]; do
    local current_runtime
    current_runtime="$(cat "$RUNTIME_FILE" 2>/dev/null || true)"
    if [ -n "$current_runtime" ] && [ "$current_runtime" != "$PREV_RUNTIME" ]; then
      return 0
    fi
    attempts=$((attempts + 1))
    sleep 0.1
  done
  echo "Timed out waiting for parasor runtime file: $RUNTIME_FILE" >&2
  return 1
}

pnpm --filter @parasor/server dev &
wait_for_runtime
pnpm --filter @parasor/web dev &

wait
