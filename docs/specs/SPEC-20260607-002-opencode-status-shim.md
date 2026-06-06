# SPEC-20260607-002: OpenCode Status Shim Injection

Status: Done
Created: 2026-06-07
Related: none

## Summary

Install an OpenCode shim that injects a parasor-managed OpenCode plugin so OpenCode lifecycle events reach `/hook/notify`.

## Background

`opencode` is recognized by the output tracker and the server event map, but the running dev instance shows no OpenCode hook events. The observed state changes are output-driven: `running` is set from terminal output and only returns to `idle` after the detector timeout. Claude and Codex avoid this delay because their shims inject per-process hooks; OpenCode needs the same class of integration.

## Tasks

- [x] T-1
  - scope: `packages/server/src/cli/shim-installer.ts`
  - action: write an OpenCode plugin and wrapper under parasor config, using `OPENCODE_CONFIG_DIR` without editing user OpenCode config
  - verify: generated wrapper/plugin tests cover notify/debug wiring and shell overlays expose `opencode`
- [x] T-2
  - scope: `packages/server/src/cli/shim-installer.test.ts`
  - action: add smoke coverage for OpenCode plugin, wrapper, and shell function injection
  - verify: `pnpm --filter @parasor/server exec vitest src/cli/shim-installer.test.ts`

## Decision Log

- 2026-06-07 04:01 | Inject via `OPENCODE_CONFIG_DIR` | OpenCode documents custom config directories for plugins; this gives parasor a per-process plugin without modifying `~/.config/opencode` or project `.opencode`.
- 2026-06-07 04:06 | Do not override existing `OPENCODE_CONFIG_DIR` | A user-provided custom OpenCode config directory may contain their own agents/plugins; skipping injection is safer than silently replacing it.

## Changed Files

- `packages/server/src/cli/shim-installer.ts` — added OpenCode plugin generation, wrapper generation, and shell overlay functions.
- `packages/server/src/cli/shim-installer.test.ts` — added smoke tests for OpenCode plugin/wrapper/shell overlay.
- `docs/specs/SPEC-20260607-002-opencode-status-shim.md` — recorded scope and verification.

## Test Results

- `pnpm --filter @parasor/server exec vitest src/cli/shim-installer.test.ts` — passed, 25 tests.
- `pnpm lint` — passed.
- `pnpm --filter @parasor/server typecheck` — passed.
- `pnpm --filter @parasor/server build` — passed.
- `node --check /tmp/parasor-dev/opencode/plugins/parasor-status.js` — passed.

## Notes

- The running dev server generated `/tmp/parasor-dev/bin/opencode` and `/tmp/parasor-dev/opencode/plugins/parasor-status.js`.
- OpenCode sessions that were already running before the shim existed will not receive the plugin; start a new OpenCode session to verify immediate `session.idle` updates.

## Deferred

- (None)
