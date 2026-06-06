# SPEC-20260607-001: OpenCode Agent Status Completion

Status: Done
Created: 2026-06-07
Related: none

## Summary

Add OpenCode hook event normalization so OpenCode sessions can leave the sidebar working state when a conversation becomes idle.

## Background

OpenCode is already recognized by the manual output tracker and foreground-process eligibility, but `/hook/notify` rejects `agent: "opencode"` because the hook event map only lists Claude, Codex, and manual agents. Output-based detection can mark activity as running, but hook-managed OpenCode status needs an explicit completed/idle transition; otherwise a running hook state cannot be cleared by weaker terminal output.

## Tasks

- [x] T-1
  - scope: `packages/server/src/agent-detector/event-map.ts`
  - action: add OpenCode as a known agent and normalize its status/plugin events to parasor lifecycles
  - verify: event map tests cover OpenCode active, idle, permission, and unknown events
- [x] T-2
  - scope: `packages/server/src/agent-detector/event-map.test.ts`
  - action: add focused OpenCode mapping coverage
  - verify: `pnpm --filter @parasor/server exec vitest packages/server/src/agent-detector/event-map.test.ts`
- [x] T-3
  - scope: `packages/server/src/routes/hook.test.ts`
  - action: add endpoint-level coverage for `agent: "opencode"` `session.idle`
  - verify: `pnpm --filter @parasor/server exec vitest src/routes/hook.test.ts`

## Decision Log

- 2026-06-07 03:37 | Use hook event mapping rather than UI special-casing | Sidebar already derives working/attention/idle from normalized lifecycles; the missing behavior is server-side OpenCode event normalization.
- 2026-06-07 03:40 | Keep bare `session.status` unknown | OpenCode status requires a discriminator such as `session.status:idle`; mapping the bare event would risk turning retry/error/idle into the wrong UI state.

## Changed Files

- `packages/server/src/agent-detector/event-map.ts` — added OpenCode agent/event normalization.
- `packages/server/src/agent-detector/event-map.test.ts` — added OpenCode mapping coverage.
- `packages/server/src/routes/hook.test.ts` — added `/hook/notify` dispatch coverage for OpenCode idle.
- `docs/specs/SPEC-20260607-001-opencode-agent-status.md` — recorded scope and verification.

## Test Results

- `pnpm --filter @parasor/server exec vitest src/agent-detector/event-map.test.ts src/routes/hook.test.ts` — passed, 63 tests.
- `pnpm lint` — passed.
- `pnpm --filter @parasor/server typecheck` — passed.
- `pnpm --filter @parasor/server build` — passed.

## Deferred

- (None)
