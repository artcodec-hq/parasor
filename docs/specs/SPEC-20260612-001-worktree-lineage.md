# SPEC-20260612-001: Worktree lineage metadata

Status: Done
Created: 2026-06-12
Related: issue#21

> Subsystem decomposition check: this is one coordinated change across shared
> worktree metadata, server worktree creation/hydration, and sidebar display.

---

## Part 1 — Plan

### Summary

Persist lightweight worktree lineage metadata and surface it as conservative workspace context.

### Background

Parasor already discovers git worktrees and exposes worktree-scoped panes,
files, Git state, terminal sessions, and a path-derived `origin: "agent"` hint.
That hint is useful but transient and inferred only from directory prefixes; it
does not capture which flow created a worktree, which worktree it was created
from, or which terminal command started in it. The issue asks for a small
product-level metadata model that helps users understand related workspaces
without implying autonomous manager/worker coordination or changing branch
cleanup safety.

The rejected alternatives are: storing lineage only in the `Worktree` cache
(lost on restart and overwritten by `git worktree list`), deriving all lineage
from path prefixes (too weak for UI-created worktrees), and adding a graph-like
task/work item model here (belongs to broader coordination work).

### Requirements

1. Store worktree lineage as server-owned project state that survives reloads.
2. Preserve existing worktree discovery, path fencing, branch rename, and
   removal safety.
3. Capture explicit lineage for UI-created worktree sessions when the parent
   worktree is known.
4. Keep inferred agent/path hints display-only and unavailable for destructive
   cleanup decisions.
5. Hydrate old state and externally-created worktrees without migration breakage.
6. Show lineage context in the sidebar without introducing coordination semantics.

### Acceptance Criteria

- [x] AC-1: UI-created worktree sessions persist an explicit lineage record with instance id, source, parent worktree path, creation time, and creating command/session context where available.
- [x] AC-2: Hydrated worktree lists merge persisted lineage metadata into `Worktree` entries while old state files and untracked external worktrees continue to render.
- [x] AC-3: Removing a worktree removes its metadata and does not use lineage metadata to decide branch or force cleanup behavior.
- [x] AC-4: Sidebar rows can show conservative lineage/provenance context without changing existing agent/orphan pills or worktree selection behavior.
- [x] AC-5: Focused tests cover metadata normalization, creation capture, hydration merge, cleanup, reducer behavior, and sidebar display.

### Tasks

- [x] T-1
  - scope: `packages/shared/src/runtime.ts`, `packages/shared/src/state.ts`
  - action: add shared lineage types on `Worktree`, add `ProjectState.worktreeMetadata`, and normalize old/malformed persisted state safely
  - verify: shared/server state tests pass
  - covers: AC-1, AC-2
- [x] T-2
  - scope: `packages/server/src/application/workspace`
  - action: persist explicit metadata during worktree creation, merge metadata into queried worktrees, and delete metadata on removal
  - verify: focused workspace command/query tests
  - covers: AC-1, AC-2, AC-3
- [x] T-3
  - scope: `packages/server/src/routes/projects.ts`, `packages/web/src/features/workspace/worktree-api.ts`, `packages/web/src/App.tsx`, `packages/web/src/components/overlays/OpenContainerDialog.tsx`
  - action: thread parent worktree and command context from the worktree session flow into the create request
  - verify: focused web API/dialog tests
  - covers: AC-1
- [x] T-4
  - scope: `packages/web/src/components/sidebar`
  - action: project lineage into the sidebar view model and render compact lineage context without changing row selection semantics
  - verify: sidebar model/row tests
  - covers: AC-4
- [x] T-5
  - scope: verification
  - action: run focused tests plus lint, typecheck, build, and full test as relevant
  - verify: command exit codes
  - covers: AC-5

### Verification Mapping

| AC   | Verified by                                | Where                                      |
| ---- | ------------------------------------------ | ------------------------------------------ |
| AC-1 | creation route/command tests, web API test | server workspace tests, `worktree-api.test` |
| AC-2 | normalization/query tests                  | `app-state.test`, project query tests       |
| AC-3 | remove command/route tests                 | workspace project/worktree tests           |
| AC-4 | sidebar model/row tests                    | sidebar tests                              |
| AC-5 | focused tests, lint/typecheck/build/test   | command output                             |

### Risks / Assumptions

- ASSUMPTION: `ProjectState` is the right persistence owner because it is server-owned in both in-process and remote daemon modes — resolution required at: implementation.
- RISK: path reuse can make stale metadata look current — mitigation: attach an `instanceId`, creation timestamp, and remove metadata when worktrees are removed.
- RISK: lineage UI could imply autonomous coordination — mitigation: show it as provenance/relationship context only; no automatic branch cleanup or orchestration behavior.

### Technical Design

Add a bounded `WorktreeLineageMetadata` shape and store it as
`ProjectState.worktreeMetadata[path]`. `Worktree` carries an optional `lineage`
field after server merge so websocket hydration and existing reducers can keep
using the current `worktrees` map. Explicit metadata comes from
`POST /projects/:id/worktrees` when the UI opens the new-worktree-session flow
from a known worktree. Existing path-derived `origin: "agent"` remains a
display hint and may be represented as inferred lineage only when no explicit
metadata exists.

Deletion removes only the metadata for the removed path. Stale parent
references are tolerated and treated as display-only. Branch rename keeps
metadata because the worktree path remains stable.

---

## Part 2 — Implementation Record

### Decision Log

- 2026-06-12 05:33 | use local implementation without subagents | available multi-agent tool policy permits spawning only when the user explicitly requests delegation; user requested a new branch and implementation | spawning rejected by tool policy
- 2026-06-12 05:33 | persist lineage under `ProjectState.worktreeMetadata` | projectStates are server-owned and already hold worktree-scoped UI state across daemon modes | cache-only lineage, project-level array storage
- 2026-06-12 05:51 | fence lineage parent paths to project root or registered worktrees | lineage is display-only but persisted, so arbitrary client-supplied paths should not be stored | trusting client parent path, storing parent path before validation

### Deviations from Plan

- (None)

### Changed Files

- `packages/shared/src/runtime.ts` — added worktree lineage metadata types and optional `Worktree.lineage`.
- `packages/shared/src/state.ts` — added `ProjectState.worktreeMetadata` and normalization.
- `packages/server/src/state/app-state.ts` — hydrates normalized metadata from persisted state.
- `packages/server/src/state/project-manager.ts` — initializes metadata map for new projects.
- `packages/server/src/application/workspace/project-queries.ts` — merges persisted lineage into queried worktrees.
- `packages/server/src/application/workspace/worktree-commands.ts` — captures, stores, and removes lineage metadata.
- `packages/server/src/routes/projects.ts` — accepts normalized lineage input and wires metadata persistence.
- `packages/server/src/bootstrap/wire-runtime.ts` — preserves lineage during project-created worktree enumeration.
- `packages/server/src/index.ts` — preserves lineage during startup cache priming and reconciliation.
- `packages/web/src/features/workspace/worktree-api.ts` — posts optional lineage context.
- `packages/web/src/App.tsx` — threads UI worktree-session lineage context.
- `packages/web/src/components/overlays/OpenContainerDialog.tsx` — includes parent worktree path in new worktree session input.
- `packages/web/src/components/sidebar/model/types.ts` — carries lineage in sidebar worktree model.
- `packages/web/src/components/sidebar/model/sidebar-model.ts` — projects lineage into sidebar model.
- `packages/web/src/components/sidebar/rows/WorktreeRow.tsx` — renders a compact linked lineage pill.
- `packages/server/src/state/app-state.test.ts` — covers metadata normalization.
- `packages/server/src/application/workspace/project-queries.test.ts` — covers metadata merge.
- `packages/server/src/application/workspace/worktree-commands.test.ts` — covers creation capture, parent path filtering, and cleanup.
- `packages/server/src/routes/projects.test.ts` — covers route-level metadata storage.
- `packages/web/src/features/workspace/worktree-api.test.ts` — covers API payload.
- `packages/web/src/components/overlays/OpenContainerDialog.test.tsx` — covers parent path payload.
- `packages/web/src/components/sidebar/model/sidebar-model.test.ts` — covers lineage projection.
- `packages/web/src/components/sidebar/rows/WorktreeRow.test.tsx` — covers linked pill rendering.

### Test Results

- `pnpm --filter @parasor/server exec vitest run src/state/app-state.test.ts src/application/workspace/worktree-commands.test.ts src/application/workspace/project-queries.test.ts src/routes/projects.test.ts` — pass, 130 tests.
- `pnpm --filter @parasor/web exec vitest run --config vitest.config.ts --project=unit src/features/workspace/worktree-api.test.ts src/components/overlays/OpenContainerDialog.test.tsx src/components/sidebar/rows/WorktreeRow.test.tsx src/components/sidebar/model/sidebar-model.test.ts` — pass, 60 tests.
- `pnpm --filter @parasor/server exec vitest run src/application/workspace/worktree-commands.test.ts src/routes/projects.test.ts` — pass, 97 tests.
- `pnpm --filter @parasor/server exec vitest run src/application/workspace/worktree-commands.test.ts` — pass, 42 tests.
- `pnpm lint` — pass.
- `pnpm typecheck` — pass.
- `pnpm build` — pass.
- `pnpm test` — pass, 133 server files / 1694 tests and 117 web files / 1084 tests.
- `git diff --check` — pass.
- secret scan over `git diff` — no real secrets; only test fixture `SECRET=1` matched.

### Deferred

- (None)
