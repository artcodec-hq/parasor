import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface ShimPaths {
  binDir: string;
  bashRcPath: string;
  realOpen: string | null;
  realXdgOpen: string | null;
  zshDotdir: string;
}

const CLAUDE_HOOK_SCRIPT_NAME = "parasor-claude-hook.sh";
const CODEX_EVENT_SCRIPT_NAME = "parasor-codex-event.sh";
const CODEX_NOTIFY_SCRIPT_NAME = "parasor-codex-notify.sh";

export function installShims(configDir: string): ShimPaths {
  const binDir = join(configDir, "bin");
  const shellDir = join(configDir, "shell");
  const zshDotdir = join(shellDir, "zsh");
  const bashDir = join(shellDir, "bash");
  const bashRcPath = join(bashDir, ".bashrc");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(zshDotdir, { recursive: true });
  mkdirSync(bashDir, { recursive: true });

  const realOpen = resolveRealBinary("open", binDir);
  const realXdgOpen = resolveRealBinary("xdg-open", binDir);

  if (realOpen) {
    writeFileSync(
      join(binDir, "open"),
      `#!/bin/sh\nexec parasor shim-open --kind=macos-open -- "$@"\n`,
      { mode: 0o755 },
    );
  }

  if (realXdgOpen) {
    writeFileSync(
      join(binDir, "xdg-open"),
      `#!/bin/sh\nexec parasor shim-open --kind=xdg-open -- "$@"\n`,
      { mode: 0o755 },
    );
  }

  // Standalone Claude Code hook bridge. The Claude wrapper points its
  // hooks JSON at this script directly instead of `parasor hook claude`,
  // because Node.js cold start (100-300ms per invocation) is the bottleneck
  // for sidebar status latency -- every PreToolUse / PostToolUse / Stop
  // pays the boot cost while Claude Code blocks on hook completion. A
  // posix shell + curl one-shot runs in single-digit milliseconds.
  const claudeHookPath = join(binDir, CLAUDE_HOOK_SCRIPT_NAME);
  writeFileSync(claudeHookPath, buildClaudeHookBridge(), { mode: 0o755 });

  // Claude Code wrapper. Sits in PATH ahead of the real `claude` binary,
  // injects per-invocation `--settings <hooks JSON>` so Claude Code's hook
  // events fire the bridge script for each state transition. We do not
  // touch the user's `~/.claude/settings.json` -- Claude Code's `--settings`
  // flag accepts an inline JSON string and merges additively at runtime.
  writeFileSync(
    join(binDir, "claude"),
    buildClaudeWrapper(binDir, claudeHookPath),
    {
      mode: 0o755,
    },
  );

  // Codex wrapper. Unlike Claude, Codex's native hooks currently require a
  // hooks.json layer, which would either mutate the user's ~/.codex or force
  // us to swap CODEX_HOME (and therefore auth/config) for the whole process.
  // To stay app-contained, we follow a runtime-only path instead:
  // inject a per-process notify command and record the TUI session log, then
  // translate the explicit task/approval events into parasor hook-notify
  // signals.
  const codexEventPath = join(binDir, CODEX_EVENT_SCRIPT_NAME);
  const codexNotifyPath = join(binDir, CODEX_NOTIFY_SCRIPT_NAME);
  writeFileSync(codexEventPath, buildCodexEventBridge(), { mode: 0o755 });
  writeFileSync(codexNotifyPath, buildCodexNotifyBridge(), { mode: 0o755 });
  writeFileSync(
    join(binDir, "codex"),
    buildCodexWrapper(binDir, codexEventPath, codexNotifyPath),
    {
      mode: 0o755,
    },
  );

  writeFileSync(join(zshDotdir, ".zshenv"), buildParasorZshEnv(binDir), {
    mode: 0o644,
  });
  writeFileSync(join(zshDotdir, ".zshrc"), buildParasorZshRc(binDir), {
    mode: 0o644,
  });
  writeFileSync(bashRcPath, buildParasorBashRc(binDir), {
    mode: 0o644,
  });

  return { bashRcPath, binDir, realOpen, realXdgOpen, zshDotdir };
}

export function buildCodexEventBridge(): string {
  return `#!/bin/sh
# parasor Codex event bridge.
#
# Receives a normalized Codex event name as argv[1] and POSTs it directly
# to parasor's loopback hook endpoint. Used by the Codex wrapper's session
# log watcher for task_started / task_complete / *_approval_request events.

set -u

[ -z "\${PARASOR_PORT:-}" ] && exit 0
[ -z "\${PARASOR_SESSION_ID:-}" ] && exit 0

EVENT="\${1:-}"
[ -z "$EVENT" ] && exit 0

BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"agent\\":\\"codex\\",\\"event\\":\\"$EVENT\\"}"
DEBUG_BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"codex-session-log\\",\\"detail\\":\\"$EVENT\\"}"

curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/debug" \\
  -H "Content-Type: application/json" \\
  -d "$DEBUG_BODY" \\
  --connect-timeout 1 \\
  --max-time 2 \\
  -o /dev/null \\
  >/dev/null 2>&1 || true

curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/notify" \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  --connect-timeout 1 \\
  --max-time 2 \\
  -o /dev/null \\
  >/dev/null 2>&1 || true

exit 0
`;
}

export function buildCodexNotifyBridge(): string {
  return `#!/bin/sh
# parasor Codex notify bridge.
#
# Codex's runtime \`notify\` config appends a single JSON payload argument
# after each completed turn. We extract the payload's event type (usually
# agent-turn-complete) and forward it to parasor as a high-confidence Codex
# lifecycle event.

set -u

[ -z "\${PARASOR_PORT:-}" ] && exit 0
[ -z "\${PARASOR_SESSION_ID:-}" ] && exit 0

PAYLOAD="\${1:-}"
[ -z "$PAYLOAD" ] && exit 0

field() {
  printf '%s' "$PAYLOAD" \\
    | grep -oE "\\"$1\\"[[:space:]]*:[[:space:]]*\\"[^\\"]*\\"" \\
    | head -n1 \\
    | sed -E "s/^\\"$1\\"[[:space:]]*:[[:space:]]*\\"([^\\"]*)\\"$/\\1/"
}

EVENT=$(field type)
[ -z "$EVENT" ] && EVENT=$(field event)
[ -z "$EVENT" ] && EVENT=$(field hook_event_name)
[ -z "$EVENT" ] && exit 0

BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"agent\\":\\"codex\\",\\"event\\":\\"$EVENT\\"}"
DEBUG_BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"codex-notify\\",\\"detail\\":\\"$EVENT\\"}"

curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/debug" \\
  -H "Content-Type: application/json" \\
  -d "$DEBUG_BODY" \\
  --connect-timeout 1 \\
  --max-time 2 \\
  -o /dev/null \\
  >/dev/null 2>&1 || true

curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/notify" \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  --connect-timeout 1 \\
  --max-time 2 \\
  -o /dev/null \\
  >/dev/null 2>&1 || true

exit 0
`;
}

/**
 * Build the posix-shell source of the Claude Code hook bridge. Reads a
 * Claude Code hook payload on stdin, extracts the event name (plus a
 * payload-driven discriminator for PreToolUse/Notification), and POSTs
 * the normalized {sessionId, agent, event} triple to the loopback
 * /hook/notify endpoint. Always exits 0 so a hook failure never breaks
 * the agent. Returns inline so the script content can be unit-tested.
 *
 * Why this is a separate file and not inlined into the wrapper's hooks
 * JSON: hook commands are a single argv[0], not a shell snippet, and
 * embedding multi-line shell into JSON is illegible. Keeping it in its
 * own file under the shim binDir also lets users inspect what they're
 * running.
 */
export function buildClaudeHookBridge(): string {
  // Composed as a string template so the script can grow without
  // fighting JS escape rules. The shell-side variables are all
  // unprefixed identifiers (PAYLOAD, EVENT, ...) so backticks stay free.
  return `#!/bin/sh
# parasor Claude Code hook bridge.
#
# Auto-installed by parasor into its shim binDir. Claude Code invokes
# this script for each subscribed hook event with a JSON payload on
# stdin. We extract the event name (plus a payload-driven discriminator
# where the downstream state mapping needs one) and POST it to the
# loopback parasor server. Always exits 0 -- a hook failure must never
# break the agent.
#
# Why a shell script and not the typed \`parasor hook claude\` Node CLI:
# Claude Code blocks on hook completion before advancing the agent loop,
# and a Node cold start of 100-300ms per hook is enough to make the
# sidebar's running/idle indicator visibly lag. A posix shell + curl
# one-shot runs in single-digit milliseconds.

set -u

# Bail when the parasor server isn't reachable. PARASOR_PORT and
# PARASOR_SESSION_ID are set on every PTY parasor spawns; if they're
# missing we're not running under a live parasor session.
[ -z "\${PARASOR_PORT:-}" ] && exit 0
[ -z "\${PARASOR_SESSION_ID:-}" ] && exit 0

PAYLOAD=$(cat)
[ -z "$PAYLOAD" ] && exit 0

# Extract a single \`"key":"value"\` string field from PAYLOAD by name.
# Tolerates whitespace around the colon. The fields we actually read
# (hook_event_name, tool_name, notification_type) are short snake_case
# identifiers from Claude Code's own enums and never contain escaped
# quotes, so a regex extractor is safe -- we explicitly accept that this
# would not survive arbitrary JSON.
field() {
  printf '%s' "$PAYLOAD" \\
    | grep -oE "\\"$1\\"[[:space:]]*:[[:space:]]*\\"[^\\"]*\\"" \\
    | head -n1 \\
    | sed -E "s/^\\"$1\\"[[:space:]]*:[[:space:]]*\\"([^\\"]*)\\"$/\\1/"
}

EVENT=$(field hook_event_name)
[ -z "$EVENT" ] && exit 0

# Discriminate events whose downstream state mapping depends on a
# payload field (see agent-detector/event-map.ts). The composite key
# is parsed in mapEventType() with a fallback to the bare event class,
# so adding a new tool here just lets future overrides specialize it.
case "$EVENT" in
  PreToolUse)
    TOOL=$(field tool_name)
    [ -n "$TOOL" ] && EVENT="$EVENT:$TOOL"
    ;;
  Notification)
    NTYPE=$(field notification_type)
    [ -n "$NTYPE" ] && EVENT="$EVENT:$NTYPE"
    ;;
esac

# Hand-built JSON body. Every value comes from a server-set env var
# or one of Claude Code's enum strings, so there's no quoting hazard.
BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"agent\\":\\"claude\\",\\"event\\":\\"$EVENT\\"}"
DEBUG_BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"claude-hook-bridge\\",\\"detail\\":\\"$EVENT\\"}"

curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/debug" \\
  -H "Content-Type: application/json" \\
  -d "$DEBUG_BODY" \\
  --connect-timeout 1 \\
  --max-time 2 \\
  -o /dev/null \\
  >/dev/null 2>&1 || true

# Short timeouts so a flaky local server can't stall the agent loop.
curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/notify" \\
  -H "Content-Type: application/json" \\
  -d "$BODY" \\
  --connect-timeout 1 \\
  --max-time 2 \\
  -o /dev/null \\
  >/dev/null 2>&1 || true

if [ "\${PARASOR_HOOK_DEBUG:-}" = "1" ]; then
  printf '[parasor-hook] %s\\n' "$EVENT" >&2
fi

exit 0
`;
}

/**
 * Build the bash source of the claude wrapper. Inline so it can read the
 * shim binDir at install time and avoid self-reference loops.
 */
export function buildClaudeWrapper(
  binDir: string,
  hookScriptPath: string,
): string {
  // Hooks JSON. Every event uses the same command (the inline bash hook
  // bridge above), which parses Claude Code's stdin payload and forwards
  // a normalized event to the loopback /hook/notify endpoint.
  //
  // Nine core events are subscribed (server-side normalized via
  // agent-detector/event-map.ts -> AgentState.lifecycle):
  //   SessionStart      -> noop on the server (no visible status flash)
  //   UserPromptSubmit  -> running   (user typed a prompt)
  //   PreToolUse        -> usually running; only explicit hand-off tools
  //                                  (AskUserQuestion / ExitPlanMode)
  //                                  are elevated to waiting by the event
  //                                  map after we include tool_name in the
  //                                  forwarded event string.
  //   PermissionRequest -> waiting   (official Claude permission dialog)
  //   PermissionDenied  -> running   (auto-mode denial; Claude keeps going)
  //   PostToolUse       -> running   (tool finished, agent thinking again)
  //   Stop              -> completed (assistant finished its turn)
  //   Notification      -> only specific user-input-required subtypes map
  //                                  to waiting; generic notifications are
  //                                  ignored conservatively.
  //   Elicitation       -> waiting   (MCP asked the user a question)
  //   ElicitationResult -> running   (user answered; Claude resumes)
  //   SessionEnd        -> idle      (Ctrl+C cleanup -- Stop does not fire)
  const hookEntry = {
    matcher: "",
    hooks: [{ type: "command", command: hookScriptPath, timeout: 5 }],
  };
  const hooksJson = JSON.stringify({
    hooks: {
      SessionStart: [hookEntry],
      UserPromptSubmit: [hookEntry],
      PreToolUse: [hookEntry],
      PermissionRequest: [hookEntry],
      PermissionDenied: [hookEntry],
      PostToolUse: [hookEntry],
      Stop: [hookEntry],
      Notification: [hookEntry],
      Elicitation: [hookEntry],
      ElicitationResult: [hookEntry],
      SessionEnd: [hookEntry],
    },
  });

  // `find_real_claude` walks PATH skipping our own binDir so we never
  // exec ourselves recursively. `inside_parasor` confirms we're still
  // running under a live parasor server before injecting hooks -- if the
  // server crashed mid-session and PARASOR_PORT is stale, fall through
  // to the real claude unmodified rather than silently breaking every
  // prompt.
  return `#!/usr/bin/env bash
# parasor claude wrapper -- injects --settings hooks JSON so Claude Code's
# SessionStart / UserPromptSubmit / PreToolUse / PermissionRequest /
# PermissionDenied / Stop / Notification / Elicitation /
# ElicitationResult / SessionEnd hooks call back into parasor via the
# typed \`parasor hook claude\` bridge. Auto-installed by parasor into its
# shim binDir, which the server prepends to PATH for every PTY it spawns.
# No global Claude config (~/.claude/settings.json) is modified.

set -u

SHIM_DIR='${binDir}'
# HOOKS_JSON is embedded as a bash single-quoted string. Single-quoted
# strings in bash don't interpret backslashes, so JSON escapes (e.g. \\n)
# survive intact. The only character that needs escaping is the literal
# single quote, which we close-quote-escape-reopen with the standard
# '\\'' trick. The embedded JSON below is produced by JSON.stringify
# from a fixed object literal in shim-installer.ts, so no user-controlled
# content lands here -- the escape pass is a future-proofing belt.
HOOKS_JSON='${hooksJson.replace(/'/g, "'\\''")}'

find_real_claude() {
  local IFS=:
  for d in $PATH; do
    [ -z "$d" ] && continue
    [ "$d" = "$SHIM_DIR" ] && continue
    if [ -x "$d/claude" ] && [ "$d/claude" != "$0" ]; then
      printf '%s\\n' "$d/claude"
      return 0
    fi
  done
  return 1
}

inside_parasor() {
  [ -n "\${PARASOR_PORT:-}" ] || return 1
  [ -n "\${PARASOR_SESSION_ID:-}" ] || return 1
  return 0
}

REAL_CLAUDE="$(find_real_claude)" || {
  echo 'parasor claude shim: real claude binary not found in PATH' >&2
  exit 127
}

# Pass through subcommands that don't accept --settings (or where
# injecting hooks would be meaningless).
case "\${1:-}" in
  mcp|config|api-key|migrate-installer|update|doctor|help|--help|-h|--version|-v)
    exec "$REAL_CLAUDE" "$@"
    ;;
esac

# Outside parasor: passthrough cleanly.
if ! inside_parasor; then
  exec "$REAL_CLAUDE" "$@"
fi

DEBUG_BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"claude-wrapper-exec\\",\\"detail\\":\\"\${1:-}\\"}"
curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/debug" \\
  -H "Content-Type: application/json" \\
  -d "$DEBUG_BODY" \\
  --connect-timeout 1 \\
  --max-time 2 \\
  -o /dev/null \\
  >/dev/null 2>&1 || true

# Parasor active -- inject hooks. \`parasor hook claude\` reads each hook's
# stdin payload (which Claude Code populates with hook_event_name etc.)
# and forwards the normalized state via the loopback HTTP endpoint.
#
# When PARASOR_UPLOAD_DIR is set (upload staging isolation -- chat composer drops live
# under $TMPDIR/parasor/uploads/, outside the project tree), extend
# Claude Code's cwd allowlist with --add-dir so the agent can read files
# the user just dropped. PARASOR_UPLOAD_DIR is exported by the parasor
# server for every PTY it spawns; absent on legacy installs, in which case
# we omit the flag.
EXTRA_ARGS=()
if [ -n "\${PARASOR_UPLOAD_DIR:-}" ]; then
  EXTRA_ARGS+=(--add-dir "$PARASOR_UPLOAD_DIR")
fi
exec "$REAL_CLAUDE" --settings "$HOOKS_JSON" "\${EXTRA_ARGS[@]}" "$@"
`;
}

export function buildCodexWrapper(
  binDir: string,
  eventScriptPath: string,
  notifyScriptPath: string,
): string {
  const notifyConfig = JSON.stringify(["bash", notifyScriptPath]);

  return `#!/usr/bin/env bash
# parasor codex wrapper -- injects a per-process notify command and records
# the Codex TUI session log so task_started / task_complete /
# *_approval_request can be mirrored into parasor without editing the
# user's ~/.codex files. This follows the same runtime-only approach
# the runtime-only wrapper uses when native hooks are unavailable or undesirable.

set -u

SHIM_DIR='${binDir}'
CODEX_EVENT_SCRIPT='${eventScriptPath}'
NOTIFY_ARG='${notifyConfig.replace(/'/g, "'\\''")}'

find_real_codex() {
  local IFS=:
  for d in $PATH; do
    [ -z "$d" ] && continue
    [ "$d" = "$SHIM_DIR" ] && continue
    if [ -x "$d/codex" ] && [ "$d/codex" != "$0" ]; then
      printf '%s\\n' "$d/codex"
      return 0
    fi
  done
  return 1
}

inside_parasor() {
  [ -n "\${PARASOR_PORT:-}" ] || return 1
  [ -n "\${PARASOR_SESSION_ID:-}" ] || return 1
  return 0
}

emit_debug() {
  [ -n "\${PARASOR_PORT:-}" ] || return 0
  [ -n "\${PARASOR_SESSION_ID:-}" ] || return 0
  local label
  local detail
  label="\${1:-codex-wrapper-exec}"
  detail="\${2:-}"
  local body
  body="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"$label\\",\\"detail\\":\\"$detail\\"}"
  curl -s -X POST "http://127.0.0.1:$PARASOR_PORT/hook/debug" \\
    -H "Content-Type: application/json" \\
    -d "$body" \\
    --connect-timeout 1 \\
    --max-time 2 \\
    -o /dev/null \\
    >/dev/null 2>&1 || true
}

start_session_log_watcher() {
  export CODEX_TUI_RECORD_SESSION=1

  if [ -z "\${CODEX_TUI_SESSION_LOG_PATH:-}" ]; then
    local stamp
    stamp="$(date +%s 2>/dev/null || printf '%s' "$$")"
    export CODEX_TUI_SESSION_LOG_PATH="\${TMPDIR:-/tmp}/parasor-codex-session-$PARASOR_SESSION_ID-$stamp.jsonl"
    emit_debug codex-wrapper-session-log-path created
  else
    emit_debug codex-wrapper-session-log-path provided
  fi
  emit_debug codex-wrapper-watcher-start

  (
    local log_path="$CODEX_TUI_SESSION_LOG_PATH"
    local last_turn_id=""
    local last_completion_id=""
    local last_approval_id=""
    local last_exec_call_id=""
    local fallback_seq=0
    local saw_line=0
    local i=0

    while [ ! -f "$log_path" ] && [ "$i" -lt 200 ]; do
      i=$((i + 1))
      sleep 0.05
    done
    if [ ! -f "$log_path" ]; then
      emit_debug codex-wrapper-watcher-timeout
      exit 0
    fi
    emit_debug codex-wrapper-watcher-ready "$i"

    tail -n 0 -F "$log_path" 2>/dev/null | while IFS= read -r line; do
      if [ "$saw_line" -eq 0 ]; then
        saw_line=1
        emit_debug codex-wrapper-session-log-line first
      fi
      case "$line" in
        *'"dir":"from_tui"'*'"kind":"op"'*'"UserTurn"'*)
          emit_debug codex-wrapper-session-log-event task_started_from_tui
          "$CODEX_EVENT_SCRIPT" task_started >/dev/null 2>&1 || true
          ;;
        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"task_started"'*)
          turn_id=$(printf '%s\\n' "$line" | awk -F'"turn_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$turn_id" ] || turn_id=$(printf '%s\\n' "$line" | awk -F'"id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$turn_id" ] || turn_id="task_started"
          if [ "$turn_id" != "$last_turn_id" ]; then
            last_turn_id="$turn_id"
            emit_debug codex-wrapper-session-log-event task_started
            "$CODEX_EVENT_SCRIPT" task_started >/dev/null 2>&1 || true
          fi
          ;;
        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"task_complete"'*)
          completion_id=$(printf '%s\\n' "$line" | awk -F'"turn_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$completion_id" ] || completion_id=$(printf '%s\\n' "$line" | awk -F'"id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$completion_id" ] || completion_id="task_complete"
          if [ "$completion_id" != "$last_completion_id" ]; then
            last_completion_id="$completion_id"
            emit_debug codex-wrapper-session-log-event task_complete
            "$CODEX_EVENT_SCRIPT" task_complete >/dev/null 2>&1 || true
          fi
          ;;
        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"'*'_approval_request"'*)
          approval_event=$(printf '%s\\n' "$line" | awk -F'"type":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$approval_event" ] || approval_event="request_user_input"
          approval_id=$(printf '%s\\n' "$line" | awk -F'"id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$approval_id" ] || approval_id=$(printf '%s\\n' "$line" | awk -F'"approval_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$approval_id" ] || approval_id=$(printf '%s\\n' "$line" | awk -F'"call_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          if [ -z "$approval_id" ]; then
            fallback_seq=$((fallback_seq + 1))
            approval_id="approval_request_$fallback_seq"
          fi
          if [ "$approval_id" != "$last_approval_id" ]; then
            last_approval_id="$approval_id"
            emit_debug codex-wrapper-session-log-event "$approval_event"
            "$CODEX_EVENT_SCRIPT" "$approval_event" >/dev/null 2>&1 || true
          fi
          ;;
        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"request_user_input"'*)
          approval_id=$(printf '%s\\n' "$line" | awk -F'"call_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$approval_id" ] || approval_id=$(printf '%s\\n' "$line" | awk -F'"id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          [ -n "$approval_id" ] || approval_id="request_user_input"
          if [ "$approval_id" != "$last_approval_id" ]; then
            last_approval_id="$approval_id"
            emit_debug codex-wrapper-session-log-event request_user_input
            "$CODEX_EVENT_SCRIPT" request_user_input >/dev/null 2>&1 || true
          fi
          ;;
        *'"dir":"to_tui"'*'"kind":"codex_event"'*'"msg":{"type":"exec_command_begin"'*)
          exec_call_id=$(printf '%s\\n' "$line" | awk -F'"call_id":"' 'NF > 1 { sub(/".*/, "", $2); print $2; exit }')
          if [ -n "$exec_call_id" ]; then
            if [ "$exec_call_id" != "$last_exec_call_id" ]; then
              last_exec_call_id="$exec_call_id"
              emit_debug codex-wrapper-session-log-event exec_command_begin
              "$CODEX_EVENT_SCRIPT" exec_command_begin >/dev/null 2>&1 || true
            fi
          else
            emit_debug codex-wrapper-session-log-event exec_command_begin
            "$CODEX_EVENT_SCRIPT" exec_command_begin >/dev/null 2>&1 || true
          fi
          ;;
      esac
    done
  ) &

  PARASOR_CODEX_WATCHER_PID=$!
}

stop_session_log_watcher() {
  if [ -n "\${PARASOR_CODEX_WATCHER_PID:-}" ]; then
    kill "$PARASOR_CODEX_WATCHER_PID" >/dev/null 2>&1 || true
    wait "$PARASOR_CODEX_WATCHER_PID" 2>/dev/null || true
  fi
}

if inside_parasor; then
  emit_debug codex-wrapper-entry "\${1:-}"
  emit_debug codex-wrapper-realpath-start
fi

REAL_CODEX="$(find_real_codex)" || {
  echo 'parasor codex shim: real codex binary not found in PATH' >&2
  emit_debug codex-wrapper-realpath missing
  exit 127
}
emit_debug codex-wrapper-realpath found

case "\${1:-}" in
  exec|review|login|logout|mcp|marketplace|mcp-server|app-server|app|completion|sandbox|debug|apply|cloud|exec-server|features|help|--help|-h|--version|-V)
    exec "$REAL_CODEX" "$@"
    ;;
esac

if ! inside_parasor; then
  exec "$REAL_CODEX" "$@"
fi

emit_debug codex-wrapper-exec "\${1:-}"
start_session_log_watcher

emit_debug codex-wrapper-exec-start "\${1:-}"
"$REAL_CODEX" -c "notify=$NOTIFY_ARG" "$@"
PARASOR_CODEX_STATUS=$?
emit_debug codex-wrapper-exit "$PARASOR_CODEX_STATUS"

stop_session_log_watcher
exit "$PARASOR_CODEX_STATUS"
`;
}

export function buildParasorZshEnv(binDir: string): string {
  return `# parasor zsh env overlay
if [ -f "$HOME/.zshenv" ]; then
  source "$HOME/.zshenv"
fi
export PATH='${binDir}':"$PATH"
`;
}

export function buildParasorZshRc(binDir: string): string {
  return `# parasor zsh rc overlay
if [ -f "$HOME/.zshrc" ]; then
  source "$HOME/.zshrc"
fi
export PATH='${binDir}':"$PATH"
unalias claude 2>/dev/null || true
unalias codex 2>/dev/null || true
claude() {
  command '${join(binDir, "claude")}' "$@"
}
codex() {
  command '${join(binDir, "codex")}' "$@"
}
rehash 2>/dev/null || true
`;
}

export function buildParasorBashRc(binDir: string): string {
  return `# parasor bash rc overlay
if [ -f "$HOME/.bashrc" ]; then
  source "$HOME/.bashrc"
fi
export PATH='${binDir}':"$PATH"
unalias claude 2>/dev/null || true
unalias codex 2>/dev/null || true
claude() {
  command '${join(binDir, "claude")}' "$@"
}
codex() {
  command '${join(binDir, "codex")}' "$@"
}
hash -r 2>/dev/null || true
`;
}

function resolveRealBinary(name: string, shimBinDir: string): string | null {
  try {
    const allPaths = execFileSync("which", ["-a", name], {
      encoding: "utf-8",
      timeout: 3000,
      env: {
        ...process.env,
        PATH: (process.env.PATH ?? "")
          .split(":")
          .filter((p) => p !== shimBinDir)
          .join(":"),
      },
    })
      .trim()
      .split("\n")
      .filter((p) => p && !p.startsWith(shimBinDir));

    return allPaths[0] ?? null;
  } catch {
    return null;
  }
}
