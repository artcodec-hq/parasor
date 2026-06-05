import { cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree.js";

/*
 * FileTree project reset regression: swapping a filetree pane with a sibling caused
 * the tree content to disappear. Root cause was a non-idempotent reset in
 * the projectId effect -- under React 19 StrictMode the passive-effect
 * re-cycle (dev-only correctness pass) ran the effect body again with the
 * same projectId and wiped the loaded entries.
 *
 * The guard below verifies the invariant: the entries cache is cleared
 * only when projectId actually changes, not on every effect invocation.
 */

interface MockEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

function mockFetch(entriesByProject: Record<string, MockEntry[]>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const params = new URL(url, "http://localhost").searchParams;
    const projectId = params.get("projectId") ?? "";
    const entries = entriesByProject[projectId] ?? [];
    return {
      ok: true,
      status: 200,
      json: async () => ({ entries }),
    } as Response;
  });
}

describe("FileTree projectId reset guard ", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockFetch({
      "project-a": [
        { name: "a.ts", path: "a.ts", type: "file" },
        { name: "src", path: "src", type: "directory" },
      ],
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("preserves loaded entries across StrictMode double-invocation on mount", async () => {
    const { findByText, queryByText } = render(
      <StrictMode>
        <FileTree
          projectId="project-a"
          expandedPaths={[]}
          onToggleExpand={() => {}}
        />
      </StrictMode>,
    );

    expect(await findByText("a.ts")).toBeTruthy();
    expect(queryByText("src")).toBeTruthy();
    expect(queryByText("Loading…")).toBeNull();
  });

  it("does not refetch on rerender with the same projectId", async () => {
    const fetchSpy = global.fetch as ReturnType<typeof vi.fn>;
    const { findByText, rerender } = render(
      <FileTree
        projectId="project-a"
        expandedPaths={[]}
        onToggleExpand={() => {}}
      />,
    );

    expect(await findByText("a.ts")).toBeTruthy();
    const callsAfterMount = fetchSpy.mock.calls.length;

    rerender(
      <FileTree
        projectId="project-a"
        expandedPaths={[]}
        onToggleExpand={() => {}}
      />,
    );

    await waitFor(() => {
      expect(fetchSpy.mock.calls.length).toBe(callsAfterMount);
    });
  });
});
