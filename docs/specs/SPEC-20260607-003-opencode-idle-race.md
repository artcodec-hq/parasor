# SPEC-20260607-003: OpenCode Idle Race

Status: Done
Created: 2026-06-07
Related: none

## Summary

Prevent OpenCode post-idle message update events from moving completed sessions back to working.

## Background

The target session `019f56eb-0ae7-44c1-9937-7ec9a3eb4b8a` confirmed the OpenCode shim and plugin are active: `opencode-wrapper-entry`, `opencode-plugin-event`, `session.status:idle`, and `session.idle` all reached `/hook/notify`. The remaining bug is event ordering: OpenCode emits `message.updated` after `session.status:idle`, and parasor currently maps `message.updated` to `running`, so the sidebar returns to working after completion.

## Tasks

- [x] T-1
  - scope: `packages/server/src/agent-detector/event-map.ts`
  - action: map `session.status:busy` to running and treat post-render update events as noop
  - verify: OpenCode event-map tests cover idle followed by message update
- [x] T-2
  - scope: `packages/server/src/agent-detector/event-map.test.ts`
  - action: update OpenCode mapping coverage for busy/noop event behavior
  - verify: `pnpm --filter @parasor/server exec vitest src/agent-detector/event-map.test.ts`
- [x] T-3
  - scope: `packages/server/src/cli/shim-installer.ts`
  - action: filter OpenCode plugin event forwarding to lifecycle-relevant events only
  - verify: generated plugin contains `FORWARDED_EVENTS` and omits message delta forwarding

## Decision Log

- 2026-06-07 04:18 | Use status events as lifecycle authority | OpenCode `session.status:*` events carry lifecycle semantics; message update events also happen after idle and should not drive agent status.
- 2026-06-07 04:23 | Filter noisy plugin events before `/hook/notify` | OpenCode can emit many `message.part.delta` events; not forwarding them avoids rate-limit pressure before the final idle event.

## Changed Files

- `packages/server/src/agent-detector/event-map.ts` — added `session.status:busy`, changed OpenCode message updates/deltas to noop.
- `packages/server/src/agent-detector/event-map.test.ts` — covered busy status and post-idle message update behavior.
- `packages/server/src/cli/shim-installer.ts` — filtered OpenCode plugin forwarding to lifecycle-relevant events.
- `packages/server/src/cli/shim-installer.test.ts` — covered plugin filtering.
- `docs/specs/SPEC-20260607-003-opencode-idle-race.md` — recorded diagnosis and verification.

## Test Results

- `pnpm --filter @parasor/server exec vitest src/agent-detector/event-map.test.ts src/cli/shim-installer.test.ts` — passed, 68 tests.
- `pnpm lint` — passed.
- `pnpm --filter @parasor/server typecheck` — passed.
- `pnpm --filter @parasor/server build` — passed.
- `node --check /tmp/parasor-dev/opencode/plugins/parasor-status.js` — passed.

## Deferred

- (None)
