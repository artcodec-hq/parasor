import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentState } from "@parasor/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AgentStateStore } from "./agent-state-store.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "parasor-agent-state-"));
  roots.push(root);
  return root;
}

function state(sessionId: string): AgentState {
  return {
    sessionId,
    lifecycle: "waiting",
    source: "hook",
    confidence: "high",
    detectedAt: 123,
  };
}

describe("AgentStateStore", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists agent states across store instances", () => {
    const root = tempRoot();
    const store = new AgentStateStore({ dir: root });

    store.set(state("s1"));

    const reloaded = new AgentStateStore({ dir: root });
    expect(reloaded.getStates()).toEqual({ s1: state("s1") });
  });

  it("prunes restored states to live sessions", () => {
    const root = tempRoot();
    const store = new AgentStateStore({ dir: root });
    store.set(state("live"));
    store.set(state("ended"));

    expect(store.getStates({ liveSessionIds: ["live"] })).toEqual({
      live: state("live"),
    });

    const file = JSON.parse(
      readFileSync(join(root, "agent-state.json"), "utf8"),
    ) as { states: Record<string, AgentState> };
    expect(file.states).toEqual({ live: state("live") });
  });

  it("ignores malformed persisted states instead of failing startup", () => {
    const root = tempRoot();
    writeFileSync(
      join(root, "agent-state.json"),
      JSON.stringify({
        version: 1,
        states: {
          good: state("good"),
          mismatch: { ...state("other"), sessionId: "other" },
          bad: { sessionId: "bad", lifecycle: "bogus" },
        },
      }),
    );

    const store = new AgentStateStore({ dir: root });
    expect(store.getStates()).toEqual({ good: state("good") });
  });
});
