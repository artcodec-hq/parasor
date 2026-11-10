# WORKFLOW.md

Project-specific task contract for Parasor repository work.

## Test Environment

- Production Parasor is the installed service on `:7681` with
  `PARASOR_CONFIG_DIR=~/.config/parasor`. Do not use it for implementation or
  E2E verification.
- The standard development test environment is the user-started `pnpm dev`
  stack:
  - backend: `http://127.0.0.1:7682`
  - Vite web UI: `http://127.0.0.1:7683`
  - config: `/tmp/parasor-dev` unless explicitly overridden
- To run an additional isolated dev profile alongside the standard stack, set
  all three values explicitly:

  ```bash
  PARASOR_CONFIG_DIR=/tmp/parasor-monkey PORT=7782 WEB_PORT=7783 pnpm dev
  ```

  `PORT` selects the backend port, `WEB_PORT` selects the Vite frontend port,
  and `PARASOR_CONFIG_DIR` isolates app state, runtime metadata, locks, and PTY
  state. Browser E2E for that profile must target the selected Vite URL
  (`http://127.0.0.1:7783` in the example), and API checks must target the
  selected backend URL (`http://127.0.0.1:7782` in the example).
- Assume the user starts the test environment. Before E2E, check whether
  `:7682` and `:7683` are already listening.
- If the test environment is not available, ask the user before starting it.
  Do not silently fall back to production `:7681`.
- Browser E2E should target the Vite UI on `:7683`, not the production service
  URL. API checks should target the dev backend on `:7682`.
- Do not create sessions, restart services, install local builds, or mutate
  state in production `:7681` unless the user explicitly asks for production
  validation.

## Quality Checks

- Use focused tests first for the touched area, then run broader checks when the
  change risk justifies it.
- Before review, run the relevant checks. At minimum for code changes, run
  focused tests, `pnpm lint`, and `pnpm build`.
- For E2E-related fixes, complete a real browser check against the development
  test environment before reporting completion.
