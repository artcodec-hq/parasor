#!/usr/bin/env tsx
import type { TerminalTraceEvent } from "../packages/web/src/lib/terminal-trace.js";
/**
 * Baseline harness reader. Pulls the server-side terminal trace ring (which
 * accumulates every client upload and survives page reloads) and folds it
 * through the SAME `computeTerminalKpis` the in-browser `kpi()` uses, so the
 * baseline numbers don't depend on the volatile 2000-entry client ring that
 * high-frequency render/scroll events evict under load.
 *
 * Usage:
 *   pnpm tsx scripts/terminal-kpi.ts [port]
 *   PARASOR_PORT=7682 pnpm tsx scripts/terminal-kpi.ts
 */
import {
  computeTerminalKpis,
  type TerminalKpiReport,
} from "../packages/web/src/lib/terminal-trace-kpi.js";

const port = process.argv[2] ?? process.env.PARASOR_PORT ?? "7682";
const url = `http://127.0.0.1:${port}/api/debug/terminal-trace?limit=2000`;

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
      "server terminal trace is DISABLED -- start dev with PARASOR_TERMINAL_TRACE=1",
    );
    process.exit(1);
  }

  const clientEvents = (body.events ?? [])
    .filter((event) => event.type === "client-event" && event.payload)
    .map((event) => asTraceEvent(event.payload as Record<string, unknown>))
    .filter((event): event is TerminalTraceEvent => event !== null);

  const report: TerminalKpiReport = computeTerminalKpis(clientEvents);
  console.log(`source: ${url}`);
  console.log(
    `client events folded: ${clientEvents.length} of ${body.eventCount}`,
  );
  console.log(JSON.stringify(report, null, 2));
}

void main();
