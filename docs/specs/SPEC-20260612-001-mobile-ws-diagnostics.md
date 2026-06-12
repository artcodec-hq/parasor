# SPEC-20260612-001: Mobile WebSocket reconnect diagnostics

Status: In Progress
Created: 2026-06-12
Related: none

## Summary

Add trace-gated points that distinguish mobile auth preflight stalls from WebSocket, server, and terminal resize delays.

## Background

Mobile use reported terminal display instability and repeated reconnects. Existing diagnostics show 67-68 second auth/open durations, but they do not correlate client preflight start, server receipt, server response, browser visibility, and WebSocket close/reconnect details. Timeout or reconnect behavior changes are rejected for this step because the immediate need is to collect causal evidence without changing production behavior.

Release constraint: detailed diagnostics must be available in release builds only when `terminalTrace` is enabled. With `terminalTrace` disabled, the auth preflight path must not create trace IDs, attach trace headers, install temporary lifecycle listeners, write client trace events, or cause server trace retention.

## Tasks

- [x] T-1
  - scope: `packages/web/src/lib/auth-fetch.ts`
  - action: Add optional auth preflight trace metadata with correlation IDs and client lifecycle context, only when tracing is requested.
  - verify: focused auth-fetch tests.
- [x] T-2
  - scope: `packages/web/src/hooks/useEventSocket.ts`, `packages/web/src/hooks/useTerminalSocket.ts`, `packages/web/src/components/overlays/AuthGate.tsx`
  - action: Record auth preflight, reconnect, and close details using the new metadata.
  - verify: focused socket/AuthGate tests where applicable.
- [x] T-3
  - scope: `packages/server/src/bootstrap/create-app-server.ts`, `packages/server/src/debug/terminal-trace-recorder.ts`, `packages/server/src/routes/debug-terminal-trace.ts`
  - action: Record `/api/auth/verify` server receipt/completion using the client correlation ID.
  - verify: focused server route/trace tests.

## Decision Log

- 2026-06-12 09:09 | Add diagnostics before behavior changes | Current evidence localizes the delay to auth preflight, but cannot yet distinguish browser freeze, request dispatch delay, response delivery delay, or server-side handling.
- 2026-06-12 09:16 | Keep auth behavior unchanged | Timeout/retry changes would affect production reconnect semantics before the root cause is measured.
- 2026-06-12 09:45 | Gate diagnostics behind terminalTrace | Release builds need diagnosability without adding normal-user request headers, lifecycle listeners, trace retention, or storage pressure when tracing is off.

## Changed Files

- `packages/web/src/lib/auth-fetch.ts` — added optional auth preflight trace events and correlation header only when a trace callback is supplied.
- `packages/web/src/lib/auth-fetch.test.ts` — verifies trace events/correlation header when requested and no trace header otherwise.
- `packages/web/src/lib/terminal-trace.ts` — added trace payload fields.
- `packages/web/src/hooks/useEventSocket.ts` — records auth preflight, close, and reconnect scheduling details.
- `packages/web/src/hooks/useTerminalSocket.ts` — records auth preflight and close details for terminal sockets.
- `packages/web/src/hooks/useTerminalSocket.test.ts` — updated auth preflight mock expectation.
- `packages/web/src/components/overlays/AuthGate.tsx` — records initial auth preflight details.
- `packages/server/src/bootstrap/create-app-server.ts` — records `/api/auth/verify` server receipt/completion with trace ID.
- `packages/server/src/debug/terminal-trace-recorder.ts` — added `auth-verify` event type.
- `packages/server/src/routes/debug-terminal-trace.ts` — allows new client trace fields through sanitization.

## Verification Procedure

1. Enable and clear diagnostics from an authenticated browser/session:
   - `POST /api/debug/diagnostics` body `{"enabled":true,"clear":true}`
2. Open mobile app with tracing enabled:
   - `http://100.116.46.113:7681/?terminalTrace=1`
3. Reproduce one cycle:
   - open a terminal pane
   - type a few characters
   - background the browser for at least 60 seconds or toggle mobile connectivity/Tailscale
   - return to the tab and type again
4. Fetch trace:
   - `GET /api/debug/terminal-trace`
5. Group by `traceId`:
   - Compare client `auth-preflight` `phase=start|complete|error`
   - Compare server `auth-verify` `phase=server-received|server-complete`
   - Compare `event-socket-close`, `event-socket-reconnect-scheduled`, `socket-close`, and `socket-reconnect-scheduled`
6. Interpret:
   - client start much earlier than server received, server duration tiny: request was not dispatched until browser/network resumed.
   - server received immediately, server duration large: server-side handler or middleware stalled.
   - server duration tiny but client completion delayed: response delivery or browser task resumption stalled.
   - close/reconnect loops without long auth preflight: WebSocket/keepalive path is separate from auth preflight.

## Test Results

- `pnpm --filter @parasor/web exec vitest run src/lib/auth-fetch.test.ts src/hooks/useTerminalSocket.test.ts src/hooks/useEventSocket.test.ts` — passed.
- `pnpm --filter @parasor/server exec vitest run src/routes/debug-terminal-trace.test.ts src/routes/debug-diagnostics.test.ts` — passed.
- `pnpm --filter @parasor/web typecheck` — passed.
- `pnpm --filter @parasor/server typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm build` — passed.
- `pnpm test` — passed.

## Deferred

- Auth preflight timeout/retry behavior changes.
