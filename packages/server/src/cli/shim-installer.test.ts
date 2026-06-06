import { describe, expect, it } from "vitest";
import {
  buildClaudeHookBridge,
  buildClaudeWrapper,
  buildCodexEventBridge,
  buildCodexNotifyBridge,
  buildCodexWrapper,
  buildOpenCodePlugin,
  buildOpenCodeWrapper,
  buildParasorBashRc,
  buildParasorZshEnv,
  buildParasorZshRc,
} from "./shim-installer.js";

/*
 * Static smoke tests for the bash hook bridge. We don't actually exec the
 * script here -- that would require a real Claude Code session and a live
 * parasor server -- but we verify that every load-bearing element is in the
 * generated source. If someone breaks the script during a refactor these
 * assertions catch the regression at unit-test time instead of in
 * production after the next agent-state bug report.
 */
describe("buildClaudeHookBridge", () => {
  const script = buildClaudeHookBridge();

  it("starts with a posix shell shebang", () => {
    expect(script.startsWith("#!/bin/sh")).toBe(true);
  });

  it("bails when the parasor env vars aren't set", () => {
    expect(script).toContain("PARASOR_PORT");
    expect(script).toContain("PARASOR_SESSION_ID");
    expect(script).toMatch(/exit 0/);
  });

  it("reads the hook payload from stdin", () => {
    expect(script).toMatch(/PAYLOAD=\$\(cat\)/);
  });

  it("extracts hook_event_name, tool_name and notification_type", () => {
    expect(script).toContain("hook_event_name");
    expect(script).toContain("tool_name");
    expect(script).toContain("notification_type");
  });

  it("composes PreToolUse:<tool> and Notification:<type> discriminators", () => {
    expect(script).toMatch(/EVENT="\$EVENT:\$TOOL"/);
    expect(script).toMatch(/EVENT="\$EVENT:\$NTYPE"/);
  });

  it("posts to the loopback /hook/notify endpoint with short timeouts", () => {
    expect(script).toContain("127.0.0.1:$PARASOR_PORT/hook/notify");
    expect(script).toContain("127.0.0.1:$PARASOR_PORT/hook/debug");
    expect(script).toContain("--connect-timeout 1");
    expect(script).toContain("--max-time 2");
  });

  it("sends agent=claude in the JSON body", () => {
    expect(script).toContain('\\"agent\\":\\"claude\\"');
  });

  it("emits debug output only when PARASOR_HOOK_DEBUG=1", () => {
    expect(script).toContain("PARASOR_HOOK_DEBUG");
    expect(script).toContain("[parasor-hook]");
  });

  it("always exits 0 so a hook failure can't break the agent", () => {
    // Last non-empty line should be `exit 0`.
    const trimmed = script.trimEnd().split("\n");
    expect(trimmed[trimmed.length - 1]).toBe("exit 0");
  });
});

describe("buildClaudeWrapper", () => {
  const script = buildClaudeWrapper("/tmp/parasor/bin", "/tmp/parasor/hook.sh");

  it("subscribes to explicit permission and elicitation events", () => {
    expect(script).toContain("PermissionRequest");
    expect(script).toContain("PermissionDenied");
    expect(script).toContain("Elicitation");
    expect(script).toContain("ElicitationResult");
  });

  it("emits a wrapper execution breadcrumb to /hook/debug", () => {
    expect(script).toContain("claude-wrapper-exec");
    expect(script).toContain("/hook/debug");
  });

  it("injects --add-dir for PARASOR_UPLOAD_DIR when set (upload staging isolation)", () => {
    // The wrapper appends `--add-dir "$PARASOR_UPLOAD_DIR"` to the real
    // claude exec when the env is non-empty so the chat-composer drop dir
    // (which lives outside the project tree) is reachable from the agent
    // cwd allowlist. When unset, no --add-dir is added (legacy installs).
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal shell parameter expansion in generated script.
    expect(script).toContain('if [ -n "${PARASOR_UPLOAD_DIR:-}" ]; then');
    expect(script).toContain('EXTRA_ARGS+=(--add-dir "$PARASOR_UPLOAD_DIR")');
    expect(script).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal bash array expansion in generated script.
      'exec "$REAL_CLAUDE" --settings "$HOOKS_JSON" "${EXTRA_ARGS[@]}" "$@"',
    );
  });
});

describe("buildCodexEventBridge", () => {
  const script = buildCodexEventBridge();

  it("posts normalized codex events directly to /hook/notify", () => {
    expect(script).toContain('\\"agent\\":\\"codex\\"');
    expect(script).toContain("127.0.0.1:$PARASOR_PORT/hook/notify");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal shell default expansion in generated script.
    expect(script).toContain('EVENT="${1:-}"');
  });
});

describe("buildCodexNotifyBridge", () => {
  const script = buildCodexNotifyBridge();

  it("extracts type / event / hook_event_name from the notify payload", () => {
    expect(script).toContain("EVENT=$(field type)");
    expect(script).toContain("EVENT=$(field event)");
    expect(script).toContain("EVENT=$(field hook_event_name)");
  });
});

describe("buildCodexWrapper", () => {
  const script = buildCodexWrapper(
    "/tmp/parasor/bin",
    "/tmp/parasor/codex-event.sh",
    "/tmp/parasor/codex-notify.sh",
  );

  it("records the Codex TUI session log and watches task/approval events", () => {
    expect(script).toContain("CODEX_TUI_RECORD_SESSION=1");
    expect(script).toContain("codex-wrapper-watcher-start");
    expect(script).toContain("codex-wrapper-watcher-ready");
    expect(script).toContain("codex-wrapper-watcher-timeout");
    expect(script).toContain("codex-wrapper-session-log-line");
    expect(script).toContain("codex-wrapper-session-log-event");
    expect(script).toContain('"dir":"from_tui"');
    expect(script).toContain('"UserTurn"');
    expect(script).toContain("task_started");
    expect(script).toContain("task_complete");
    expect(script).toContain("_approval_request");
    expect(script).toContain("exec_command_begin");
  });

  it("injects a per-process notify command instead of editing ~/.codex", () => {
    expect(script).toContain(
      `NOTIFY_ARG='["bash","/tmp/parasor/codex-notify.sh"]'`,
    );
    expect(script).toContain('"$REAL_CODEX" -c "notify=$NOTIFY_ARG" "$@"');
  });

  it("emits wrapper lifecycle breadcrumbs without raw session-log lines", () => {
    expect(script).toContain("codex-wrapper-entry");
    expect(script).toContain("codex-wrapper-realpath");
    expect(script).toContain("codex-wrapper-realpath-start");
    expect(script).toContain("codex-wrapper-session-log-path");
    expect(script).toContain("codex-wrapper-exec-start");
    expect(script).toContain("codex-wrapper-exit");
    expect(script).toContain("--connect-timeout 1");
    expect(script).toContain("--max-time 2");
    expect(script).not.toContain('\\"detail\\":\\"$line\\"');
  });
});

describe("buildOpenCodePlugin", () => {
  const script = buildOpenCodePlugin();

  it("posts opencode events to /hook/notify without logging payloads", () => {
    expect(script).toContain('const AGENT = "opencode"');
    expect(script).toContain("FORWARDED_EVENTS");
    expect(script).toContain("/hook/notify");
    expect(script).toContain("/hook/debug");
    expect(script).toContain("opencode-plugin-event");
    expect(script).not.toContain("JSON.stringify(event)");
  });

  it("discriminates session.status by status.type", () => {
    expect(script).toContain('if (type === "session.status")');
    expect(script).toContain("event.properties?.status");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal JS template syntax in generated plugin.
    expect(script).toContain("`${type}:${value}`");
  });

  it("does not forward noisy message delta events", () => {
    expect(script).toContain('FORWARDED_EVENTS.has(type) ? type : ""');
    expect(script).not.toContain('"message.part.delta",');
  });

  it("subscribes to tool execution hooks", () => {
    expect(script).toContain('"tool.execute.before"');
    expect(script).toContain('"tool.execute.after"');
  });
});

describe("buildOpenCodeWrapper", () => {
  const script = buildOpenCodeWrapper(
    "/tmp/parasor/bin",
    "/tmp/parasor/opencode",
  );

  it("sets OPENCODE_CONFIG_DIR to the parasor-managed config dir", () => {
    expect(script).toContain(
      "PARASOR_OPENCODE_CONFIG_DIR='/tmp/parasor/opencode'",
    );
    expect(script).toContain(
      'export OPENCODE_CONFIG_DIR="$PARASOR_OPENCODE_CONFIG_DIR"',
    );
  });

  it("does not overwrite a user-provided OPENCODE_CONFIG_DIR", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: asserting literal shell parameter expansion in generated wrapper.
    expect(script).toContain('if [ -n "${OPENCODE_CONFIG_DIR:-}" ]');
    expect(script).toContain("opencode-wrapper-config-dir-skip");
  });

  it("emits wrapper lifecycle breadcrumbs", () => {
    expect(script).toContain("opencode-wrapper-entry");
    expect(script).toContain("opencode-wrapper-config-dir");
    expect(script).toContain("--connect-timeout 1");
    expect(script).toContain("--max-time 2");
  });
});

describe("shell overlay builders", () => {
  it("reasserts the shim path after sourcing the user's zsh env and rc", () => {
    const envScript = buildParasorZshEnv("/tmp/parasor/bin");
    const rcScript = buildParasorZshRc("/tmp/parasor/bin");

    expect(envScript).toContain('source "$HOME/.zshenv"');
    expect(envScript).toContain("export PATH='/tmp/parasor/bin':");

    expect(rcScript).toContain('source "$HOME/.zshrc"');
    expect(rcScript).toContain("export PATH='/tmp/parasor/bin':");
    expect(rcScript).toContain("claude() {");
    expect(rcScript).toContain("command '/tmp/parasor/bin/claude' \"$@\"");
    expect(rcScript).toContain("codex() {");
    expect(rcScript).toContain("command '/tmp/parasor/bin/codex' \"$@\"");
    expect(rcScript).toContain("opencode() {");
    expect(rcScript).toContain("command '/tmp/parasor/bin/opencode' \"$@\"");
  });

  it("uses a bash rc overlay that sources the user's rc before overriding claude", () => {
    const script = buildParasorBashRc("/tmp/parasor/bin");

    expect(script).toContain('source "$HOME/.bashrc"');
    expect(script).toContain("export PATH='/tmp/parasor/bin':");
    expect(script).toContain("claude() {");
    expect(script).toContain("command '/tmp/parasor/bin/claude' \"$@\"");
    expect(script).toContain("codex() {");
    expect(script).toContain("command '/tmp/parasor/bin/codex' \"$@\"");
    expect(script).toContain("opencode() {");
    expect(script).toContain("command '/tmp/parasor/bin/opencode' \"$@\"");
    expect(script).toContain("hash -r");
  });
});
