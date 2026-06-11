# SPEC-20260609-001: Server-synced sidebar state

Status: Review
Created: 2026-06-09
Related: none

> Subsystem decomposition check: this is one coordinated workspace/sidebar
> state change. Pane launcher commands, Monitor pins, and prevent-idle-sleep
> already use server state; this Spec keeps those paths intact while moving
> the remaining sidebar-only local preferences into the same server snapshot.

---

## Part 1 — Plan

### Summary

Move sidebar pane ordering and worktree disclosure state from per-browser localStorage to server-owned project state so connected clients stay synchronized.

### Background

The investigation found that project ordering, pane launcher custom commands, Monitor pins, and prevent-idle-sleep are already stored in `AppState` and delivered over the event socket. The gaps are sidebar child ordering (`paneOrder:<projectId>`) and worktree disclosure (`parasor:sidebar:worktree-open:<projectId>`), both currently browser-local. Keeping those local means desktop and mobile clients disagree about sidebar organization even though they share the same project/session data.

Rejected alternatives:

- Store sidebar state under top-level `AppState`: rejected because the state is naturally per-project and should be removed with `projectStates`.
- Reuse browser localStorage plus `storage` events: rejected because it only works within one browser profile and cannot sync remote/mobile clients.
- Reorder only the rendered sidebar model: rejected for server sync because incoming snapshots would still need a persisted source of truth.

### Requirements

1. Sidebar child pane order must be stored server-side per project and worktree path.
2. Sidebar worktree open/closed state must be stored server-side per project and worktree path.
3. Existing server-managed settings, including custom pane commands, Monitor pins, and prevent-idle-sleep, must keep their current behavior.
4. Existing localStorage sidebar preferences should be migrated once when server state is empty.

### Acceptance Criteria

- [x] AC-1: Reordering terminal/browser children in one client persists to server state and is reflected in another connected client via WebSocket.
- [x] AC-2: Expanding/collapsing a sidebar worktree persists to server state and is reflected in another connected client via WebSocket.
- [x] AC-3: Existing custom pane commands, Monitor pin, and prevent-idle-sleep APIs/tests continue to pass unchanged in behavior.
- [x] AC-4: Legacy localStorage sidebar order/disclosure data is uploaded once only when server state has no corresponding data.

### Tasks

- [x] T-1
  - scope: `packages/shared/src/state.ts`, `packages/shared/src/ws-events.ts`
  - action: add typed sidebar state to `ProjectState` and a WebSocket event for sidebar state updates
  - verify: shared/server/web TypeScript checks and reducer tests compile
  - covers: AC-1, AC-2
- [x] T-2
  - scope: `packages/server/src/state`, `packages/server/src/routes`, `packages/server/src/application/workspace`
  - action: migrate/default sidebar state, add a server command and REST route to patch it, and broadcast updates
  - verify: server route/state tests
  - covers: AC-1, AC-2, AC-3
- [x] T-3
  - scope: `packages/web/src/components/sidebar`, `packages/web/src/App.tsx`, `packages/web/src/hooks`
  - action: replace sidebar localStorage order/disclosure reads with hydrated server state and event reducer updates
  - verify: web reducer/sidebar tests
  - covers: AC-1, AC-2
- [x] T-4
  - scope: `packages/web/src/features/workspace`
  - action: migrate legacy localStorage sidebar preferences to the new server API once when hydrated state is empty
  - verify: migration hook tests
  - covers: AC-4
- [x] T-5
  - scope: quality gate
  - action: run relevant lint/tests/build
  - verify: commands exit 0
  - covers: AC-1, AC-2, AC-3, AC-4

### Verification Mapping

| AC   | Verified by                       | Where                  |
| ---- | --------------------------------- | ---------------------- |
| AC-1 | route/reducer/sidebar tests       | server + web test files |
| AC-2 | route/reducer/sidebar tests       | server + web test files |
| AC-3 | existing pane command/session/service tests | existing test suites |
| AC-4 | migration hook tests              | web feature tests      |

### Risks / Assumptions

- ASSUMPTION: "project open/close" refers to the sidebar worktree disclosure rows currently backed by `parasor:sidebar:worktree-open:<projectId>`; there is no separate project group disclosure state in the current UI.
- RISK: Cross-client last-writer-wins updates can overwrite near-simultaneous sidebar changes; mitigation: keep patches scoped by worktree path and field.
- RISK: Legacy localStorage may contain stale worktree paths; mitigation: preserve existing pruning behavior by only applying paths present in the current sidebar/project snapshot.

### Technical Design

Add `ProjectSidebarState` under `ProjectState`:

- `paneOrder: Record<worktreePath, paneId[]>`
- `worktreeOpen: Record<worktreePath, boolean>`

Server route shape:

- `PATCH /api/projects/:id/sidebar-state`
- body may include `paneOrder` and/or `worktreeOpen` patch maps
- server normalizes maps, merges into `projectStates[id].sidebar`, persists, and broadcasts `sidebar-state-changed`

Client flow:

- derive sidebar order from `store.projectStates[projectId].sidebar.paneOrder`
- pass server disclosure state into `WorktreeRow`
- on reorder/toggle, optimistically apply local event reducer state and fire the patch API
- migrate legacy localStorage once per project only when the server map is empty

---

## Part 2 — Implementation Record

### Decision Log

- 2026-06-09 14:22 | store sidebar sync under `ProjectState.sidebar` | state is per-project UI state and already part of hydrated snapshots | top-level AppState and localStorage-only sync rejected
- 2026-06-09 14:42 | use path-scoped sidebar patches | avoids unrelated path clobbering across clients and lets legacy pruning delete stale paths with `null` | full-field replacement rejected

### Deviations from Plan

- (None)

### Changed Files

- `packages/shared/src/state.ts` — added sidebar state, patch types, normalizers, and patch helper.
- `packages/shared/src/ws-events.ts` — added `sidebar-state-changed`.
- `packages/server/src/state/app-state.ts` / `project-manager.ts` — backfill sidebar state on load and project creation.
- `packages/server/src/application/workspace/sidebar-state-commands.ts` — added server mutation command for sidebar state.
- `packages/server/src/routes/projects.ts` — added `PATCH /api/projects/:id/sidebar-state`.
- `packages/web/src/hooks/event-reducers.ts` / `useEventSocket.ts` — hydrate/update/optimistically seed sidebar state.
- `packages/web/src/App.tsx` — replaced sidebar order/open localStorage writes with server patches and optimistic rollback.
- `packages/web/src/components/sidebar/**` — made pane ordering and disclosure controlled by server state.
- `packages/web/src/features/workspace/sidebar-state-api.ts` — added client API.
- `packages/web/src/features/workspace/useLegacySidebarStateMigration.ts` — added one-time migration from legacy localStorage.
- `*.test.*` touched alongside the files above — added/updated focused coverage.

### Test Results

- `pnpm --filter @parasor/shared typecheck && pnpm --filter @parasor/server typecheck && pnpm --filter @parasor/web typecheck` — passed.
- `pnpm --filter @parasor/server exec vitest run src/state/app-state.test.ts src/routes/projects.test.ts` — passed, 71 tests.
- `pnpm --filter @parasor/web exec vitest run --config vitest.config.ts --project=unit src/hooks/event-reducers.test.ts src/components/sidebar/model/pane-order-overrides.test.ts src/components/sidebar/rows/WorktreeRow.test.tsx src/features/workspace/useLegacySidebarStateMigration.test.ts src/App.test.tsx` — passed, 63 tests.
- `pnpm test` — passed on rerun: server 1688 tests, web 1075 tests. First run hit one unrelated best-effort `daemon-subprocess.test.ts` readiness failure; the single test passed in isolation before the full rerun.
- `pnpm lint` — passed.
- `pnpm build` — passed.

### Deferred

- (None)
