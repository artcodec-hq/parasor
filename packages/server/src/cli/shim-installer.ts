import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { nativeIntegrationHasInstallKind } from "../application/integrations/native-status-integrations.js";

export interface ShimPaths {
  binDir: string;
  bashRcPath: string;
  realOpen: string | null;
  realXdgOpen: string | null;
  zshDotdir: string;
}

const CLAUDE_HOOK_SCRIPT_NAME = "parasor-claude-hook.sh";
const CODEX_NOTIFY_SCRIPT_NAME = "parasor-codex-notify.sh";
const OPENCODE_PLUGIN_NAME = "parasor-status.js";

export function installShims(configDir: string): ShimPaths {
  const binDir = join(configDir, "bin");
  const shellDir = join(configDir, "shell");
  const zshDotdir = join(shellDir, "zsh");
  const bashDir = join(shellDir, "bash");
  const bashRcPath = join(bashDir, ".bashrc");
  const opencodeConfigDir = join(configDir, "opencode");
  const opencodePluginDir = join(opencodeConfigDir, "plugins");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(zshDotdir, { recursive: true });
  mkdirSync(bashDir, { recursive: true });
  mkdirSync(opencodePluginDir, { recursive: true });

  const realOpen = resolveRealBinary("open", binDir);
  const realXdgOpen = resolveRealBinary("xdg-open", binDir);
  const installClaudeWrapper = nativeIntegrationHasInstallKind(
    "claude",
    "shim-wrapper",
  );
  const installCodexWrapper = nativeIntegrationHasInstallKind(
    "codex",
    "shim-wrapper",
  );
  const installOpenCodeWrapper = nativeIntegrationHasInstallKind(
    "opencode",
    "shim-wrapper",
  );

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
  if (installClaudeWrapper) {
    writeFileSync(claudeHookPath, buildClaudeHookBridge(), { mode: 0o755 });
  }

  // Claude Code wrapper. Sits in PATH ahead of the real `claude` binary,
  // injects per-invocation `--settings <hooks JSON>` so Claude Code's hook
  // events fire the bridge script for each state transition. We do not
  // touch the user's `~/.claude/settings.json` -- Claude Code's `--settings`
  // flag accepts an inline JSON string and merges additively at runtime.
  if (installClaudeWrapper) {
    writeFileSync(
      join(binDir, "claude"),
      buildClaudeWrapper(binDir, claudeHookPath),
      {
        mode: 0o755,
      },
    );
  }

  // Codex wrapper. Keep the integration app-contained by injecting per-process
  // lifecycle hooks plus the runtime notify command. We do not bypass Codex
  // hook trust or read TUI logs.
  const codexNotifyPath = join(binDir, CODEX_NOTIFY_SCRIPT_NAME);
  if (installCodexWrapper) {
    writeFileSync(codexNotifyPath, buildCodexNotifyBridge(), { mode: 0o755 });
    writeFileSync(
      join(binDir, "codex"),
      buildCodexWrapper(binDir, codexNotifyPath),
      {
        mode: 0o755,
      },
    );
  }

  const opencodePluginPath = join(opencodePluginDir, OPENCODE_PLUGIN_NAME);
  if (installOpenCodeWrapper) {
    writeFileSync(opencodePluginPath, buildOpenCodePlugin(), { mode: 0o644 });
    writeFileSync(
      join(binDir, "opencode"),
      buildOpenCodeWrapper(binDir, opencodeConfigDir),
      {
        mode: 0o755,
      },
    );
  }

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

export function buildOpenCodePlugin(): string {
  return `// parasor OpenCode status plugin.
// Loaded through OPENCODE_CONFIG_DIR by the parasor opencode shim. It mirrors
// OpenCode plugin events to parasor's loopback hook endpoint without mutating
// user OpenCode config or logging event payloads.

const AGENT = "opencode";
const FORWARDED_EVENTS = new Set([
  "session.idle",
  "session.error",
  "permission.asked",
  "permission.replied",
  "question.asked",
  "question.replied",
  "question.rejected",
]);

async function post(path, body) {
  const port = process.env.PARASOR_PORT;
  if (!port || !process.env.PARASOR_SESSION_ID) return;
  try {
    await fetch(\`http://127.0.0.1:\${port}\${path}\`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    // Hook delivery is advisory UI state; never disrupt OpenCode.
  }
}

async function notify(event) {
  const sessionId = process.env.PARASOR_SESSION_ID;
  if (!sessionId || !event) return;
  await post("/hook/debug", {
    sessionId,
    label: "parasor-opencode-plugin-event",
    detail: event,
  });
  await post("/hook/notify", { sessionId, agent: AGENT, event });
}

function statusType(status) {
  if (typeof status === "string") return status;
  if (status && typeof status === "object" && typeof status.type === "string") {
    return status.type;
  }
  return "";
}

function eventName(event) {
  const type = event && typeof event.type === "string" ? event.type : "";
  if (!type) return "";
  if (type === "session.status") {
    const value = statusType(event.properties?.status);
    return value ? \`\${type}:\${value}\` : "";
  }
  return FORWARDED_EVENTS.has(type) ? type : "";
}

export const ParasorStatusPlugin = async () => {
  return {
    event: async ({ event }) => {
      await notify(eventName(event));
    },
    "tool.execute.before": async () => {
      await notify("tool.execute.before");
    },
    "tool.execute.after": async () => {
      await notify("tool.execute.after");
    },
  };
};
`;
}

export function buildCodexNotifyBridge(): string {
  return `#!/bin/sh
# parasor Codex status bridge.
#
# Codex lifecycle hooks and runtime \`notify\` both provide a small JSON
# payload. Current Codex builds pass notify payloads as argv[1]; hook payloads
# arrive on stdin. Support both and forward the event to parasor as a
# high-confidence Codex lifecycle signal.

set -u

[ -z "\${PARASOR_PORT:-}" ] && exit 0
[ -z "\${PARASOR_SESSION_ID:-}" ] && exit 0

PAYLOAD="\${1:-}"
[ -z "$PAYLOAD" ] && [ ! -t 0 ] && PAYLOAD=$(cat)
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
DEBUG_BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"parasor-codex-notify\\",\\"detail\\":\\"$EVENT\\"}"

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
DEBUG_BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"parasor-claude-hook-bridge\\",\\"detail\\":\\"$EVENT\\"}"

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

DEBUG_BODY="{\\"sessionId\\":\\"$PARASOR_SESSION_ID\\",\\"label\\":\\"parasor-claude-wrapper-exec\\",\\"detail\\":\\"\${1:-}\\"}"
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
  notifyScriptPath: string,
): string {
  const notifyConfig = JSON.stringify(["bash", notifyScriptPath]);
  const codexHooks = {
    UserPromptSubmit: buildCodexHookHandler(
      notifyScriptPath,
      "parasor-codex-user-prompt-submit",
    ),
    PostToolUse: buildCodexHookHandler(
      notifyScriptPath,
      "parasor-codex-post-tool-use",
    ),
    Stop: buildCodexHookHandler(notifyScriptPath, "parasor-codex-stop"),
  };

  return `#!/usr/bin/env bash
# parasor codex wrapper -- injects per-process Codex lifecycle hooks and
# notify behavior without editing the user's ~/.codex files or bypassing hook
# trust.

set -u

SHIM_DIR='${binDir}'
NOTIFY_ARG='${notifyConfig.replace(/'/g, "'\\''")}'
HOOK_USER_PROMPT_SUBMIT='${codexHooks.UserPromptSubmit.replace(/'/g, "'\\''")}'
HOOK_POST_TOOL_USE='${codexHooks.PostToolUse.replace(/'/g, "'\\''")}'
HOOK_STOP='${codexHooks.Stop.replace(/'/g, "'\\''")}'

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
  label="\${1:-parasor-codex-wrapper-exec}"
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

if inside_parasor; then
  emit_debug parasor-codex-wrapper-entry "\${1:-}"
  emit_debug parasor-codex-wrapper-realpath-start
fi

REAL_CODEX="$(find_real_codex)" || {
  echo 'parasor codex shim: real codex binary not found in PATH' >&2
  emit_debug parasor-codex-wrapper-realpath missing
  exit 127
}
emit_debug parasor-codex-wrapper-realpath found

case "\${1:-}" in
  exec|review|login|logout|mcp|marketplace|mcp-server|app-server|app|completion|sandbox|debug|apply|cloud|exec-server|features|help|--help|-h|--version|-V)
    exec "$REAL_CODEX" "$@"
    ;;
esac

if ! inside_parasor; then
  exec "$REAL_CODEX" "$@"
fi

emit_debug parasor-codex-wrapper-exec "\${1:-}"

emit_debug parasor-codex-wrapper-exec-start "\${1:-}"
"$REAL_CODEX" \\
  -c "notify=$NOTIFY_ARG" \\
  -c "hooks.UserPromptSubmit=$HOOK_USER_PROMPT_SUBMIT" \\
  -c "hooks.PostToolUse=$HOOK_POST_TOOL_USE" \\
  -c "hooks.Stop=$HOOK_STOP" \\
  "$@"
PARASOR_CODEX_STATUS=$?
emit_debug parasor-codex-wrapper-exit "$PARASOR_CODEX_STATUS"

exit "$PARASOR_CODEX_STATUS"
`;
}

function buildCodexHookHandler(command: string, statusMessage: string): string {
  return `[{hooks=[{type="command",command=${JSON.stringify(shellSingleQuote(command))},timeout=5,statusMessage=${JSON.stringify(statusMessage)}}]}]`;
}

function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildOpenCodeWrapper(
  binDir: string,
  opencodeConfigDir: string,
): string {
  return `#!/usr/bin/env bash
# parasor opencode wrapper -- injects a parasor-managed OPENCODE_CONFIG_DIR
# containing a local plugin that mirrors OpenCode lifecycle events to
# parasor's loopback hook endpoint. The user's ~/.config/opencode and project
# .opencode directories are not modified.

set -u

SHIM_DIR='${binDir}'
PARASOR_OPENCODE_CONFIG_DIR='${opencodeConfigDir}'

find_real_opencode() {
  local IFS=:
  for d in $PATH; do
    [ -z "$d" ] && continue
    [ "$d" = "$SHIM_DIR" ] && continue
    if [ -x "$d/opencode" ] && [ "$d/opencode" != "$0" ]; then
      printf '%s\\n' "$d/opencode"
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
  label="\${1:-parasor-opencode-wrapper-exec}"
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

REAL_OPENCODE="$(find_real_opencode)" || {
  echo 'parasor opencode shim: real opencode binary not found in PATH' >&2
  emit_debug parasor-opencode-wrapper-realpath missing
  exit 127
}

case "\${1:-}" in
  help|--help|-h|--version|-v|upgrade|auth|github|github-install|models|stats|serve)
    exec "$REAL_OPENCODE" "$@"
    ;;
esac

if ! inside_parasor; then
  exec "$REAL_OPENCODE" "$@"
fi

emit_debug parasor-opencode-wrapper-entry "\${1:-}"

if [ -n "\${OPENCODE_CONFIG_DIR:-}" ] && [ "$OPENCODE_CONFIG_DIR" != "$PARASOR_OPENCODE_CONFIG_DIR" ]; then
  emit_debug parasor-opencode-wrapper-config-dir-skip "$OPENCODE_CONFIG_DIR"
  exec "$REAL_OPENCODE" "$@"
fi

export OPENCODE_CONFIG_DIR="$PARASOR_OPENCODE_CONFIG_DIR"
emit_debug parasor-opencode-wrapper-config-dir "$OPENCODE_CONFIG_DIR"
exec "$REAL_OPENCODE" "$@"
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
unalias opencode 2>/dev/null || true
claude() {
  command '${join(binDir, "claude")}' "$@"
}
codex() {
  command '${join(binDir, "codex")}' "$@"
}
opencode() {
  command '${join(binDir, "opencode")}' "$@"
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
unalias opencode 2>/dev/null || true
claude() {
  command '${join(binDir, "claude")}' "$@"
}
codex() {
  command '${join(binDir, "codex")}' "$@"
}
opencode() {
  command '${join(binDir, "opencode")}' "$@"
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
