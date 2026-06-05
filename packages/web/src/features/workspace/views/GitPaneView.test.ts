import type { GitState } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { buildGitGraphRefreshKey } from "./GitPaneView.js";

function gitState(overrides: Partial<GitState> = {}): GitState {
  return {
    branch: "main",
    dirty: false,
    ahead: 1,
    behind: 0,
    dirtyCount: 0,
    lastChecked: 1,
    ...overrides,
  };
}

describe("buildGitGraphRefreshKey", () => {
  it("changes when a successful push updates ahead/behind counters", () => {
    const beforePush = buildGitGraphRefreshKey(4, gitState({ ahead: 2 }));
    const afterPush = buildGitGraphRefreshKey(4, gitState({ ahead: 0 }));

    expect(afterPush).not.toBe(beforePush);
  });

  it("does not depend on lastChecked-only git poll churn", () => {
    const first = buildGitGraphRefreshKey(4, gitState({ lastChecked: 1 }));
    const second = buildGitGraphRefreshKey(4, gitState({ lastChecked: 2 }));

    expect(second).toBe(first);
  });
});
