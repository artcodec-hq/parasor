# SPEC-20260607-004: OpenCode Mobile Swipe Scroll

Status: Done
Created: 2026-06-07
Related: none

## Summary

Try an OpenCode-only mobile terminal gesture that converts vertical touch swipes into terminal input OpenCode can treat as TUI scrolling.

## Background

OpenCode TUI can be scrolled with a desktop trackpad because that path reaches the TUI as wheel/mouse input. On mobile, normal typing and keybar input work, but finger swipes on the terminal surface do not move the OpenCode view. The observed terminal state for the target session had `baseY: 0`, `viewportY: 0`, and no xterm scroll range, so Parasor's normal terminal scrollback cannot move the OpenCode conversation. `opencode web` is a possible separate flow, but it changes the normal terminal startup path. This experiment keeps `opencode` running in the terminal pane and scopes swipe conversion to OpenCode sessions only.

## Tasks

- [x] T-1
  - scope: `packages/web/src/features/panes/terminal/Terminal.tsx`
  - action: detect OpenCode terminal sessions from command/title and enable a mobile-only swipe scroll handler only for those sessions
  - verify: focused tests cover OpenCode detection and non-OpenCode exclusion
- [x] T-2
  - scope: `packages/web/src/features/panes/terminal/terminal-touch-gestures.ts`
  - action: convert vertical swipe deltas into bounded up/down key input after normal tap/selection slop is exceeded
  - verify: unit tests cover thresholding, direction, accumulation, and no conversion for taps/selection
- [x] T-3
  - scope: running dev app on `:7683`
  - action: verify mobile OpenCode session reacts to swipe while typing/keybar behavior still works
  - verify: Playwright/mobile or terminal trace observation records changed OpenCode visible rows after swipe

## Decision Log

- 2026-06-07 06:22 | Keep normal `opencode` flow | `opencode web` is embeddable but changes session/pane semantics; this trial preserves the terminal flow.
- 2026-06-07 06:22 | Scope gesture conversion to OpenCode | Codex and Claude Code mobile terminal behavior has been tuned separately, so this experiment must not change their generic TUI gestures.
- 2026-06-07 06:43 | Use xterm-style arrow-key input for OpenCode swipe scroll | `term.scrollLines()` fired but could not move the OpenCode viewport while `baseY: 0`; trusted xterm wheel emits PTY input, and plain up/down arrow sequences changed the mobile OpenCode view.

## Changed Files

- `packages/web/src/features/panes/terminal/Terminal.tsx`
- `packages/web/src/lib/terminal-trace.ts`
- `packages/web/src/features/panes/terminal/terminal-session-agent.ts`
- `packages/web/src/features/panes/terminal/terminal-session-agent.test.ts`
- `packages/web/src/features/panes/terminal/terminal-touch-gestures.ts`
- `packages/web/src/features/panes/terminal/terminal-touch-gestures.test.ts`

## Test Results

- `pnpm --filter @parasor/web exec vitest run --config vitest.config.ts --project=unit src/features/panes/terminal/terminal-session-agent.test.ts src/features/panes/terminal/terminal-touch-gestures.test.ts` passed: 2 files, 9 tests.
- `pnpm --filter @parasor/web exec tsc` passed.
- `pnpm lint` passed.
- `pnpm --filter @parasor/web build` passed with existing chunk-size warnings.
- Playwright mobile trace against `http://100.116.46.113:7683/sessions/019f56eb-0ae7-44c1-9937-7ec9a3eb4b8a?terminalTrace=1` observed `changedUp: true`, `changedDown: true`, `terminal-opencode-touch-scroll`, and matching `socket-send` events.

## Deferred

- (None)
