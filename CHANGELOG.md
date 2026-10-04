# Changelog

## 0.1.5 - Unreleased

### Upgrade notes

- Upgrading from 0.1.4 changes the PTY host protocol from 2.x to 3.x.
  Finish active terminal work before restarting: this upgrade ends existing
  PTY sessions. The restart command warns and requires confirmation;
  non-interactive restarts require `--yes`.

### Fixed

- Preserve terminal geometry and cursor state across focus changes and replay.
- Keep the server available when a registered project directory is missing.
- Keep Parasor listener environment variables out of child terminal sessions.
- Open complete soft-wrapped terminal URLs, including wide characters, without
  launching truncated links.
- Report unavailable remote development previews before opening a browser tab.
- Improve stale-worktree cleanup, project titles, Git refresh and sidebar use.

### Security

- Update Hono, its Node adapter, WebSocket dependencies and DOMPurify to patched
  compatible releases.
- Suspend automatic loopback forwarding and remote localhost/wildcard/same-host
  alternate-port preview links pending isolated authentication. Remote terminal
  access and local development-server access remain available. Follow-up: #127.

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
