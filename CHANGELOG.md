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
- Marked orphan worktrees more clearly in the sidebar and disabled unavailable
  child rows while keeping worktree cleanup actions available.

### Fixed

- Fixed desktop terminal reclaim behavior after mobile handoff.
- Guarded unavailable orphan worktree children from selection, pinning, and
  pane reorder actions.
