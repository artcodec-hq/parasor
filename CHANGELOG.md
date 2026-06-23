# Changelog

## 0.1.4 - 2026-06-23

### Added

- Added mobile terminal presence ownership so desktop and mobile clients can
  coordinate terminal control without losing session state.
- Added mobile session snapshots for reconnect and handoff flows.
- Expanded Git status details for sidebar and source-control views, including
  richer file status, dirty line stats, and branch state propagation.
- Added clearer Monitor sidebar indicators and a reusable monitor switch
  control.
- Documented the `dev` to `main` release branch workflow.
- Documented the project E2E workflow and ignored Playwright CLI artifacts.

### Changed

- Batched file-watch updates to reduce redundant refresh work during bursty
  filesystem changes.
- Improved source-control views to surface richer Git state without adding
  heavier interaction patterns.
- Refined the sidebar status row layout, badges, metrics, separators, and
  monitor switch alignment.
- Refined the new project and new session dialogs.
- Marked missing worktree paths more clearly in the sidebar while keeping
  remaining terminal sessions selectable and worktree cleanup actions
  available.

### Fixed

- Fixed desktop terminal ownership reclaim when a desktop terminal is engaged
  after mobile handoff.
- Guarded children under missing worktree paths from pinning and pane reorder
  actions while still allowing users to open and close remaining sessions.
- Kept stale terminal-session worktree rows visible as missing paths instead of
  treating them as live worktrees.
- Fixed terminal bootstrap timing and replay cache restore behavior.
- Improved terminal pane rendering stability.
- Linked Unicode terminal file paths correctly.
- Fixed Codex lifecycle hook status reporting.
- Fixed monitor sidebar indicators and button color regressions.
