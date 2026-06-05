#!/usr/bin/env tsx
import type { TerminalTraceEvent } from "../packages/web/src/lib/terminal-trace.js";

/**
 * Reads the server-side terminal trace and prints the event sequence around
 * terminal toolbar Copy actions. This is a focused diagnostic for the mobile
 * bug where Copy may open the soft keyboard.
 *
 * Usage:
 *   pnpm --filter @parasor/server exec tsx ../../scripts/terminal-copy-keyboard-trace.ts [port]
 *   PARASOR_PORT=7682 pnpm --filter @parasor/server exec tsx ../../scripts/terminal-copy-keyboard-trace.ts
 */

const port = process.argv[2] ?? process.env.PARASOR_PORT ?? "7682";
const url = `http://127.0.0.1:${port}/api/debug/terminal-trace?limit=5000`;
const BEFORE_MS = 250;
const AFTER_MS = 1200;

interface ServerTraceEnvelope {
  enabled?: boolean;
  eventCount?: number;
  events?: Array<{ type: string; payload?: Record<string, unknown> }>;
}

function asTraceEvent(
  payload: Record<string, unknown>,
): TerminalTraceEvent | null {
  if (typeof payload.type !== "string" || typeof payload.t !== "number") {
    return null;
  }
  return payload as unknown as TerminalTraceEvent;
}

function isCopyStart(event: TerminalTraceEvent): boolean {
  return (
    (event.type === "terminal-toolbar-action" &&
      event.surface === "copy" &&
      event.skipped !== true) ||
    event.type === "terminal-toolbar-copy-attempt"
  );
}

function isRelevant(event: TerminalTraceEvent): boolean {
  return (
    event.type === "terminal-toolbar-action" ||
    event.type.startsWith("terminal-toolbar-copy") ||
    event.type === "terminal-toolbar-synthetic-mouse-suppressed" ||
    event.type === "terminal-surface-event" ||
    event.type === "dom-focus" ||
    event.type === "dom-blur" ||
    event.type === "virtual-keyboard-viewport-event" ||
    event.type === "virtual-keyboard-height-change" ||
    event.type === "virtual-keyboard-height-skip" ||
    event.type === "virtual-keyboard-settled" ||
    event.type === "xterm-on-data" ||
    event.type === "terminal-send-input"
  );
}

function sameSessionOrGlobal(
  event: TerminalTraceEvent,
  copy: TerminalTraceEvent,
): boolean {
  return (
    !event.sessionId || !copy.sessionId || event.sessionId === copy.sessionId
  );
}

function describe(event: TerminalTraceEvent, baseT: number): string {
  const parts = [
    `${(event.t - baseT).toFixed(1).padStart(7)}ms`,
    event.type.padEnd(34),
  ];
  if (event.sessionId) parts.push(`session=${event.sessionId}`);
  if (event.surface) parts.push(`surface=${event.surface}`);
  if (event.status) parts.push(`status=${event.status}`);
  if (event.reason) parts.push(`reason=${event.reason}`);
  if (typeof event.visible === "boolean") parts.push(`active=${event.visible}`);
  if (typeof event.skipped === "boolean")
    parts.push(`skipped=${event.skipped}`);
  if (typeof event.height === "number") parts.push(`height=${event.height}`);
  if (typeof event.previousHeight === "number") {
    parts.push(`prevHeight=${event.previousHeight}`);
  }
  if (typeof event.dataLength === "number") {
    parts.push(`dataLength=${event.dataLength}`);
  }
  return parts.join("  ");
}

function summarizeWindow(
  events: TerminalTraceEvent[],
  copy: TerminalTraceEvent,
) {
  const after = events.filter(
    (event) =>
      event.t >= copy.t &&
      event.t <= copy.t + AFTER_MS &&
      sameSessionOrGlobal(event, copy),
  );
  const firstFocus = after.find((event) => event.type === "dom-focus");
  const firstKeyboardOpen = after.find(
    (event) =>
      event.type === "virtual-keyboard-height-change" &&
      typeof event.height === "number" &&
      typeof event.previousHeight === "number" &&
      event.height > event.previousHeight,
  );
  const firstSurfaceBeforeFocus = firstFocus
    ? after.find(
        (event) =>
          event.type === "terminal-surface-event" && event.t <= firstFocus.t,
      )
    : null;

  if (!firstFocus && !firstKeyboardOpen) {
    return "verdict: no textarea focus or keyboard-height increase observed after Copy";
  }
  if (firstSurfaceBeforeFocus) {
    return `verdict: terminal surface event precedes focus (${firstSurfaceBeforeFocus.status ?? "unknown"})`;
  }
  if (firstFocus) {
    return "verdict: textarea focus observed after Copy without a traced terminal surface event";
  }
  return "verdict: keyboard height increased after Copy without a traced textarea focus";
}

async function main(): Promise<void> {
  let body: ServerTraceEnvelope;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`trace endpoint ${url} returned ${res.status}`);
      process.exit(1);
    }
    body = (await res.json()) as ServerTraceEnvelope;
  } catch (err) {
    console.error(`failed to reach ${url}: ${(err as Error).message}`);
    console.error("is the dev server running? (lsof -nP -iTCP:7682,7683)");
    process.exit(1);
  }

  if (!body.enabled) {
    console.error(
      "server terminal trace is DISABLED - enable diagnostics or start with PARASOR_TERMINAL_TRACE=1",
    );
    process.exit(1);
  }

  const clientEvents = (body.events ?? [])
    .filter((event) => event.type === "client-event" && event.payload)
    .map((event) => asTraceEvent(event.payload as Record<string, unknown>))
    .filter((event): event is TerminalTraceEvent => event !== null)
    .sort((a, b) => a.t - b.t);
  const copyStarts = clientEvents.filter(isCopyStart);

  console.log(`source: ${url}`);
  console.log(`client events: ${clientEvents.length} of ${body.eventCount}`);
  console.log(`copy starts: ${copyStarts.length}`);

  if (copyStarts.length === 0) {
    console.log("No toolbar Copy action found in the current trace.");
    return;
  }

  for (const [index, copy] of copyStarts.entries()) {
    const windowEvents = clientEvents.filter(
      (event) =>
        event.t >= copy.t - BEFORE_MS &&
        event.t <= copy.t + AFTER_MS &&
        sameSessionOrGlobal(event, copy) &&
        isRelevant(event),
    );
    console.log("");
    console.log(
      `#${index + 1} copy @ ${copy.t.toFixed(1)}ms session=${copy.sessionId ?? "unknown"}`,
    );
    for (const event of windowEvents) {
      console.log(describe(event, copy.t));
    }
    console.log(summarizeWindow(clientEvents, copy));
  }
}

void main();
