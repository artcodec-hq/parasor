# SPEC-20260610-001: Terminal Mode Replay

Status: Review
Created: 2026-06-10
Related: none

## Summary

Preserve terminal mouse tracking modes in headless full replay so OpenCode TUI scroll gestures keep working after attach/reconnect.

## Background

OpenCode v1.16.2 enables mouse tracking and OpenTUI scrollboxes consume SGR mouse wheel input, but Parasor's headless full replay currently serializes only visible buffer contents and cursor position. The target session confirmed raw output contains `?1000h`, `?1002h`, `?1003h`, and `?1006h`; the full replay omitted them, leaving xterm without `enable-mouse-events`. Replaying the mode sequences alone restored xterm mouse reporting and produced SGR wheel input. Converting mobile swipe gestures to Up/Down was rejected because those keys drive OpenCode input history rather than message scrolling and would affect other TUIs.

After replay restoration, desktop wheel and trackpad scrolling work, but mobile touch swipes still do not scroll OpenCode. The observed mobile path reaches xterm as touch/mouse drag gestures while OpenCode expects wheel-style mouse input for scrollboxes. Keyboard open/close can also force a repaint that fixes a transient mobile fit artifact, so the scroll failure needs a narrowly scoped touch gesture bridge instead of weakening replay mode restoration.

## Tasks

- [x] T-1
  - scope: `packages/server/src/pty/headless-replay-snapshot.ts`
  - action: serialize a small terminal-mode prologue for relevant headless xterm modes before replay text
  - verify: focused snapshot tests prove mouse tracking modes replay into xterm
- [x] T-2
  - scope: `packages/server/src/pty/headless-replay-snapshot.test.ts`
  - action: add coverage for mouse tracking replay and byte-cap behavior
  - verify: `pnpm --filter @parasor/server exec vitest src/pty/headless-replay-snapshot.test.ts`
- [x] T-3
  - scope: `packages/web/src/features/panes/terminal/terminal-touch-gestures.ts`
  - action: convert single-finger touch swipes to wheel events while a TUI owns mouse tracking, and suppress the native touch drag path
  - verify: focused terminal touch tests prove swipes dispatch wheel only when mouse tracking is active
- [x] T-4
  - scope: `packages/web/src/features/panes/terminal/Terminal.tsx`
  - action: attach the touch-to-wheel bridge alongside existing terminal gestures
  - verify: focused terminal component tests cover listener behavior and non-mouse-tracking regression paths
- [x] T-5
  - scope: `packages/web/src/features/panes/terminal/terminal-touch-gestures.ts`
  - action: keep mobile keyboard focus limited to the terminal input row, even while a TUI owns mouse tracking
  - verify: focused terminal component tests prove input-row taps still focus and output/history taps do not

## Decision Log

- 2026-06-10 03:13 | Restore modes in replay serialization | The bug is localized to headless snapshot output dropping terminal modes; preserving mode state avoids app-specific mobile gesture conversion.
- 2026-06-10 03:19 | Limit the prologue to mouse protocol and encoding modes | Mouse tracking fixes the OpenCode mobile scroll path without replaying rendering-sensitive modes such as origin mode or alt screen.
- 2026-06-11 18:32 | Add a client-side touch-to-wheel bridge for mouse-tracking TUIs | Restored mouse mode makes desktop wheel work, but mobile swipe still enters the TUI as drag-style touch/mouse input; dispatching wheel events lets xterm encode the existing mouse protocol without app-specific key mappings.
- 2026-06-11 22:12 | Keep mobile scroll routing TUI-generic | The #6 implementation note rejects opencode-specific terminal branches, so the client-side bridge keys off xterm mouse tracking mode rather than agent identity.
- 2026-06-12 07:39 | Do not focus history taps in mouse-tracking TUIs | OpenCode history scrolling should not raise the soft keyboard; input-row taps remain the only mobile tap-to-focus path.

## Changed Files

- `docs/specs/SPEC-20260610-001-terminal-mode-replay.md` — records scope and verification plan.
- `packages/server/src/pty/headless-replay-snapshot.ts` — prepends a byte-capped mouse mode prologue to headless replay snapshots.
- `packages/server/src/pty/headless-replay-snapshot.test.ts` — covers SGR mouse replay restoration and byte-cap accounting.
- `packages/web/src/features/panes/terminal/Terminal.tsx` — attaches touch-to-wheel routing alongside existing terminal gestures.
- `packages/web/src/features/panes/terminal/terminal-touch-gestures.ts` — routes vertical touch swipes to wheel events while mouse tracking is active and disables touch text selection in that mode.
- `packages/web/src/features/panes/terminal/Terminal.test.tsx` — covers mouse-tracking touch swipe routing, horizontal swipe pass-through, and selection suppression.

## Test Results

- `pnpm --filter @parasor/server exec vitest src/pty/headless-replay-snapshot.test.ts` — passed, 13 tests.
- `pnpm --filter @parasor/server typecheck` — passed.
- `pnpm --filter @parasor/server build` — passed.
- `pnpm lint` — passed.
- `pnpm --filter @parasor/server test` — passed, 133 files / 1701 tests.
- `pnpm --filter @parasor/web exec vitest src/features/panes/terminal/Terminal.test.tsx` — passed, 107 tests.
- `pnpm --filter @parasor/web test` — passed, 115 files / 1069 tests.
- `pnpm --filter @parasor/web typecheck` — passed.
- `pnpm --filter @parasor/web build` — passed.
- `pnpm --filter @parasor/server exec vitest src/pty/headless-replay-snapshot.test.ts` — passed, 13 tests.
- `git diff --check` — passed.

## Deferred

- (None)
