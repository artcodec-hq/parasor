# Changelog

## 0.1.3 - 2026-06-20

### Added

- Added mobile terminal presence ownership so desktop and mobile clients can
  coordinate terminal control without losing session state.
- Added mobile session snapshots for reconnect and handoff flows.
- Expanded Git status details for sidebar and source-control views, including
  richer file status and branch state propagation.
- Documented the `dev` to `main` release branch workflow.

### Changed

- Batched file-watch updates to reduce redundant refresh work during bursty
  filesystem changes.
- Improved source-control views to surface richer Git state without adding
  heavier interaction patterns.
- Marked missing worktree paths more clearly in the sidebar while keeping
  remaining terminal sessions selectable and worktree cleanup actions
  available.

### Fixed

- Fixed desktop terminal reclaim behavior after mobile handoff.
- Guarded children under missing worktree paths from pinning and pane reorder
  actions while still allowing users to open and close remaining sessions.
- Kept stale terminal-session worktree rows visible as missing paths instead of
  treating them as live worktrees.
