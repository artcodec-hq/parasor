import type { GitCommit, GitRef, SwimlaneSnapshot } from "@parasor/shared";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GitGraphPane } from "./GitGraphPane.js";

/*
 * Ahead/behind badge behavior: Pull/Push footer buttons grow a numeric badge when the
 * worktree is ahead/behind its upstream, so the divergence is visible
 * without opening the SyncToast. Badge is suppressed when count is 0
 * or undefined (no upstream tracking).
 */

function mockEmptyGitLog() {
  return vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ commits: [], hasUncommitted: false }),
    } as Response;
  });
}

describe("GitGraphPane ahead/behind badges (ahead/behind badge behavior)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockEmptyGitLog() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders count badges with direction-aware aria-label when ahead/behind > 0", async () => {
    const { findByLabelText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        ahead={2}
        behind={3}
        actions={{ onPull: () => {}, onPush: () => {} }}
      />,
    );
    const pull = await findByLabelText("Pull (3 commits behind)");
    const push = await findByLabelText("Push (2 commits ahead)");
    expect(pull.textContent).toContain("3");
    expect(push.textContent).toContain("2");
  });

  it("uses singular 'commit' in aria-label when count is 1", async () => {
    const { findByLabelText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        ahead={1}
        behind={1}
        actions={{ onPull: () => {}, onPush: () => {} }}
      />,
    );
    await findByLabelText("Pull (1 commit behind)");
    await findByLabelText("Push (1 commit ahead)");
  });

  it("clamps badge display to '99+' for counts above 99", async () => {
    const { findByLabelText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        ahead={9999}
        actions={{ onPull: () => {}, onPush: () => {} }}
      />,
    );
    const push = await findByLabelText("Push (9999 commits ahead)");
    expect(push.textContent).toContain("99+");
    expect(push.textContent).not.toContain("9999");
  });

  it("omits badge and count from aria-label when count is 0 or undefined", async () => {
    const { findByLabelText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        ahead={0}
        actions={{ onPull: () => {}, onPush: () => {} }}
      />,
    );
    const pull = await findByLabelText("Pull");
    const push = await findByLabelText("Push");
    await waitFor(() => {
      expect(pull.textContent ?? "").not.toMatch(/\d/);
      expect(push.textContent ?? "").not.toMatch(/\d/);
    });
  });
});

describe("GitGraphPane refresh trigger", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = mockEmptyGitLog() as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reloads the graph when refreshSeq changes", async () => {
    const { rerender } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        refreshSeq="before-push"
        selection={null}
        onSelect={() => {}}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    rerender(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        refreshSeq="after-push"
        selection={null}
        onSelect={() => {}}
      />,
    );

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
  });

  it("fetches origin before reloading the graph from the refresh button", async () => {
    const onFetch = vi.fn(async () => {});
    const { findByLabelText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        actions={{ onFetch }}
      />,
    );

    const refresh = await findByLabelText("Refresh");
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(refresh);

    await waitFor(() => {
      expect(onFetch).toHaveBeenCalledOnce();
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    expect(onFetch.mock.invocationCallOrder[0]).toBeLessThan(
      (global.fetch as ReturnType<typeof vi.fn>).mock.invocationCallOrder[1],
    );
  });
});

function makeSwimlane(
  colorId: number,
  expectingSha: string | null,
): SwimlaneSnapshot {
  return { colorId, expectingSha };
}

function makeCommit(
  overrides: Partial<GitCommit> & { sha: string },
): GitCommit {
  return {
    parents: [],
    author: "alice",
    time: 1700000000,
    subject: `commit ${overrides.sha}`,
    refs: [],
    lane: 0,
    colorId: 0,
    inputSwimlanes: [],
    outputSwimlanes: [],
    ...overrides,
  };
}

function mockGitLog(commits: GitCommit[], hasUncommitted = false) {
  return vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({ commits, hasUncommitted }),
    } as Response;
  });
}

function createStorageMock(): Storage {
  const values = new Map<string, string>();
  return {
    clear() {
      values.clear();
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    get length() {
      return values.size;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

describe("GitGraphPane SVG renderer (git graph renderer)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: createStorageMock(),
    });
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders one commit row per commit and tags lane/colorId via data attributes", async () => {
    const commits: GitCommit[] = [
      makeCommit({
        sha: "c2",
        parents: ["c1"],
        lane: 0,
        colorId: 0,
        outputSwimlanes: [makeSwimlane(0, "c1")],
      }),
      makeCommit({
        sha: "c1",
        parents: [],
        lane: 0,
        colorId: 0,
        inputSwimlanes: [makeSwimlane(0, "c1")],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findAllByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const rows = await findAllByTestId("git-graph-commit-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].getAttribute("data-lane")).toBe("0");
    expect(rows[0].getAttribute("data-color-id")).toBe("0");
  });

  it("paints branch dot with branch color CSS variable", async () => {
    const commits: GitCommit[] = [
      makeCommit({
        sha: "c1",
        lane: 1,
        colorId: 2,
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const dot = row.querySelector("circle");
    expect(dot?.getAttribute("fill")).toBe("var(--theme-graph-branch-3)");
  });

  it("renders ref chips with ref-type data attribute", async () => {
    const refs: GitRef[] = [
      { label: "HEAD", type: "head" },
      { label: "main", type: "local" },
      { label: "origin/main", type: "remote" },
      { label: "origin/HEAD", type: "remote" },
      { label: "v1.0.0", type: "tag" },
    ];
    global.fetch = mockGitLog([
      makeCommit({ sha: "c1", refs }),
    ]) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    expect(row.querySelector("[data-ref-type='head']")?.textContent).toBe(
      "HEAD",
    );
    expect(row.querySelector("[data-ref-type='local']")?.textContent).toBe(
      "main",
    );
    expect(row.querySelector("[data-ref-type='remote']")?.textContent).toBe(
      "origin/main",
    );
    expect(row.querySelector("[data-ref-type='tag']")?.textContent).toBe(
      "v1.0.0",
    );
    expect(row.querySelector("button[data-ref-type='head']")).toBeNull();
    expect(row.querySelector("button[data-ref-type='tag']")).toBeNull();
    expect(
      Array.from(row.querySelectorAll("button[data-ref-type='remote']")).map(
        (el) => el.textContent,
      ),
    ).toEqual(["origin/main"]);
  });

  it("opens a switch action from a local branch chip without selecting the row", async () => {
    const onSelect = vi.fn();
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/git/log")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              commits: [
                makeCommit({
                  sha: "c1",
                  refs: [{ label: "feature", type: "local" }],
                }),
              ],
              hasUncommitted: false,
            }),
          } as Response;
        }
        if (url.includes("/git/switch")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toMatchObject({
            worktreePath: "/repo",
            branch: "feature",
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { findByText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={onSelect}
        currentBranch="main"
      />,
    );

    fireEvent.click(await findByText("feature"));
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(await findByText("Switch"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/git/switch"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("creates a local branch from a remote branch chip", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/git/log")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              commits: [
                makeCommit({
                  sha: "c1",
                  refs: [{ label: "origin/topic", type: "remote" }],
                }),
              ],
              hasUncommitted: false,
            }),
          } as Response;
        }
        if (url.includes("/git/branch")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toMatchObject({
            worktreePath: "/repo",
            branch: "topic",
            startPoint: "origin/topic",
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { findByRole, findByTestId, findByText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );

    const row = await findByTestId("git-graph-commit-row");
    fireEvent.click(await findByText("origin/topic"));
    const menu = await findByRole("menu");
    expect(row.contains(menu)).toBe(false);
    fireEvent.click(await findByRole("menuitem", { name: "Create & switch" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/git/branch"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("switches to an existing local branch from its remote branch chip", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/git/log")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              commits: [
                makeCommit({
                  sha: "c1",
                  refs: [
                    { label: "topic", type: "local" },
                    { label: "origin/topic", type: "remote" },
                  ],
                }),
              ],
              hasUncommitted: false,
            }),
          } as Response;
        }
        if (url.includes("/git/switch")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toMatchObject({
            worktreePath: "/repo",
            branch: "topic",
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          } as Response;
        }
        if (url.includes("/git/branch")) {
          throw new Error("remote chip should switch existing local branch");
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { findByRole, findByText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        currentBranch="main"
      />,
    );

    fireEvent.click(await findByText("origin/topic"));
    fireEvent.click(await findByRole("menuitem", { name: "Switch" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/git/switch"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("falls back to switch when create from a remote chip finds an existing local branch outside the loaded graph", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/git/log")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              commits: [
                makeCommit({
                  sha: "c1",
                  refs: [{ label: "origin/topic", type: "remote" }],
                }),
              ],
              hasUncommitted: false,
            }),
          } as Response;
        }
        if (url.includes("/git/branch")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toMatchObject({
            worktreePath: "/repo",
            branch: "topic",
            startPoint: "origin/topic",
          });
          return {
            ok: false,
            status: 409,
            json: async () => ({
              error: "fatal: a branch named 'topic' already exists",
            }),
          } as Response;
        }
        if (url.includes("/git/switch")) {
          expect(init?.method).toBe("POST");
          expect(JSON.parse(String(init?.body))).toMatchObject({
            worktreePath: "/repo",
            branch: "topic",
          });
          return {
            ok: true,
            status: 200,
            json: async () => ({ ok: true }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { findByRole, findByText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        currentBranch="main"
      />,
    );

    fireEvent.click(await findByText("origin/topic"));
    fireEvent.click(await findByRole("menuitem", { name: "Create & switch" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/git/switch"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("confirms before switching branches when the working tree is dirty", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/git/log")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            commits: [
              makeCommit({
                sha: "c1",
                refs: [{ label: "feature", type: "local" }],
              }),
            ],
            hasUncommitted: true,
          }),
        } as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { findByText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        currentBranch="main"
      />,
    );

    fireEvent.click(await findByText("feature"));
    fireEvent.click(await findByText("Switch"));

    expect(confirmSpy).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/git/switch"),
      expect.anything(),
    );
  });

  it("surfaces branch switch failures in the graph pane", async () => {
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes("/git/log")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              commits: [
                makeCommit({
                  sha: "c1",
                  refs: [{ label: "feature", type: "local" }],
                }),
              ],
              hasUncommitted: false,
            }),
          } as Response;
        }
        if (url.includes("/git/switch")) {
          expect(init?.method).toBe("POST");
          return {
            ok: false,
            status: 409,
            json: async () => ({ error: "local changes would be overwritten" }),
          } as Response;
        }
        throw new Error(`unexpected fetch: ${url}`);
      },
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const { findByText } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        currentBranch="main"
      />,
    );

    fireEvent.click(await findByText("feature"));
    fireEvent.click(await findByText("Switch"));

    await findByText("feature: local changes would be overwritten");
  });

  it("renders rows for commits beyond the visible lane cap", async () => {
    // 6 commits, last one at lane=5 (cap=5 -> off-screen). All rows should
    // still render so the subject column stays complete.
    const commits: GitCommit[] = Array.from({ length: 6 }, (_, i) =>
      makeCommit({ sha: `c${i}`, lane: i, colorId: i % 5 }),
    );
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findAllByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const rows = await findAllByTestId("git-graph-commit-row");
    expect(rows).toHaveLength(6);
    expect(rows[5].getAttribute("data-lane")).toBe("5");
  });

  it("uses 26px row height when isMobile=true", async () => {
    global.fetch = mockGitLog([
      makeCommit({ sha: "c1" }),
    ]) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
        isMobile
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    expect(row.style.height).toBe("26px");
    expect(row.querySelector("svg")?.getAttribute("height")).toBe("26");
  });

  it("draws connector path between commit dot and parent lane on a merge", async () => {
    const commits: GitCommit[] = [
      makeCommit({
        sha: "merge",
        parents: ["main", "side"],
        lane: 0,
        colorId: 0,
        inputSwimlanes: [],
        outputSwimlanes: [makeSwimlane(0, "main"), makeSwimlane(1, "side")],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const paths = row.querySelectorAll("svg path");
    // Two outputs, neither matched in input -> two new connectors out of dot.
    expect(paths.length).toBe(2);
  });

  it("places refs to the right of subject and uses current ref color for HEAD lane chips", async () => {
    const commits: GitCommit[] = [
      makeCommit({
        sha: "c1",
        colorId: 2,
        refs: [
          { label: "HEAD", type: "head" },
          { label: "feat/x", type: "local" },
          { label: "origin/feat/x", type: "remote" },
        ],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    // DOM order: svg -> subject -> refs container. Verify subject precedes refs.
    const subject = [...row.children].find(
      (el) => el.textContent === `commit c1`,
    );
    const refsHost = row.querySelector("[data-ref-type]")?.parentElement;
    expect(subject).toBeDefined();
    expect(refsHost).toBeTruthy();
    const subjectIdx = [...row.children].indexOf(subject as Element);
    const refsIdx = [...row.children].indexOf(refsHost as Element);
    expect(subjectIdx).toBeGreaterThan(-1);
    expect(refsIdx).toBeGreaterThan(subjectIdx);

    // Current local ref chips follow VSCode SCM Graph's historyItemRefColor.
    const localChip = row.querySelector(
      "[data-ref-type='local']",
    ) as HTMLElement | null;
    expect(localChip?.style.color).toContain("--theme-graph-ref-base");
    // HEAD chip uses lane color as background (solid for emphasis)
    const headChip = row.querySelector(
      "[data-ref-type='head']",
    ) as HTMLElement | null;
    expect(headChip?.style.background).toContain("--theme-graph-ref-base");
  });

  it("shrinks SVG width to fit the actual max lane in view", async () => {
    // Single-lane history -> SVG width should be the minimum (offset*2 only).
    const commits: GitCommit[] = [
      makeCommit({ sha: "c1", lane: 0, colorId: 0 }),
      makeCommit({ sha: "c2", lane: 0, colorId: 0, parents: ["c1"] }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findAllByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const rows = await findAllByTestId("git-graph-commit-row");
    const w = rows[0].querySelector("svg")?.getAttribute("width");
    // Minimal width = 2*LANE_X_OFFSET (no lane content beyond lane 0).
    expect(Number(w)).toBeLessThanOrEqual(20);
  });

  it("renders HEAD commit dot as a hollow ring (fill=bg, stroke=lane color)", async () => {
    // VSCode SCM Graph convention: the current HEAD is drawn as an outlined
    // circle so it's distinguishable at a glance from solid ancestor dots.
    const commits: GitCommit[] = [
      makeCommit({
        sha: "c1",
        lane: 0,
        colorId: 1,
        refs: [
          { label: "HEAD", type: "head" },
          { label: "main", type: "local" },
        ],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    expect(row.getAttribute("data-head")).toBe("1");
    const dot = row.querySelector("circle");
    expect(dot?.getAttribute("fill")).toBe("var(--color-bg-primary)");
    expect(dot?.getAttribute("stroke")).toBe("var(--theme-graph-ref-base)");
  });

  it("uses current ref color for the first-parent HEAD lane", async () => {
    const commits: GitCommit[] = [
      makeCommit({
        sha: "head",
        parents: ["parent"],
        lane: 0,
        colorId: 0,
        refs: [
          { label: "HEAD", type: "head" },
          { label: "main", type: "local" },
        ],
        outputSwimlanes: [makeSwimlane(0, "parent")],
      }),
      makeCommit({
        sha: "parent",
        parents: ["root"],
        lane: 0,
        colorId: 0,
        inputSwimlanes: [makeSwimlane(0, "parent")],
        outputSwimlanes: [makeSwimlane(0, "root")],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findAllByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const rows = await findAllByTestId("git-graph-commit-row");
    const headPath = rows[0].querySelector("svg path");
    const parentPath = rows[1].querySelector("svg path");
    expect(headPath?.getAttribute("stroke")).toBe(
      "var(--theme-graph-ref-base)",
    );
    expect(parentPath?.getAttribute("stroke")).toBe(
      "var(--theme-graph-ref-base)",
    );
  });

  it("renders the synthetic working tree row with the current ref graph color", async () => {
    const commits: GitCommit[] = [
      makeCommit({
        sha: "head",
        parents: ["parent"],
        lane: 0,
        colorId: 0,
        refs: [
          { label: "HEAD", type: "head" },
          { label: "main", type: "local" },
        ],
      }),
    ];
    global.fetch = mockGitLog(commits, true) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-working-tree-row");
    const connector = row.querySelector("svg path");
    const dot = row.querySelector("svg circle");
    expect(connector?.getAttribute("stroke")).toBe(
      "var(--theme-graph-ref-base)",
    );
    expect(dot?.getAttribute("stroke")).toBe("var(--theme-graph-ref-base)");
  });

  it("does not recolor merge side lanes as the current ref lane", async () => {
    const commits: GitCommit[] = [
      makeCommit({
        sha: "newer",
        parents: ["merge"],
        lane: 0,
        colorId: 0,
        refs: [
          { label: "HEAD", type: "head" },
          { label: "main", type: "local" },
        ],
        outputSwimlanes: [makeSwimlane(0, "merge")],
      }),
      makeCommit({
        sha: "merge",
        parents: ["main-parent", "side-parent"],
        lane: 0,
        colorId: 0,
        inputSwimlanes: [makeSwimlane(0, "merge"), makeSwimlane(2, "merge")],
        outputSwimlanes: [
          makeSwimlane(0, "main-parent"),
          makeSwimlane(2, "side-parent"),
        ],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findAllByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const rows = await findAllByTestId("git-graph-commit-row");
    const mergePaths = Array.from(rows[1].querySelectorAll("svg path"));
    const sideSink = mergePaths.find((p) =>
      (p.getAttribute("d") ?? "").startsWith("M22 0"),
    );
    expect(
      mergePaths.some(
        (p) => p.getAttribute("stroke") === "var(--theme-graph-ref-base)",
      ),
    ).toBe(true);
    expect(sideSink?.getAttribute("stroke")).toBe(
      "var(--theme-graph-branch-3)",
    );
  });

  it("sorts ref chips shortest-first within a row", async () => {
    // User asked: when a commit has multiple refs, render the short labels
    // first so the row stays readable when truncated.
    const refs: GitRef[] = [
      { label: "origin/feature/long-name", type: "remote" },
      { label: "feature/long-name", type: "local" },
      { label: "HEAD", type: "head" },
      { label: "v1", type: "tag" },
    ];
    global.fetch = mockGitLog([
      makeCommit({ sha: "c1", refs }),
    ]) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const chips = [...row.querySelectorAll("[data-ref-type]")];
    const labels = chips.map((c) => c.textContent);
    // Length order: v1(2), HEAD(4), feature/long-name(17), origin/feature/long-name(24)
    expect(labels).toEqual([
      "v1",
      "HEAD",
      "feature/long-name",
      "origin/feature/long-name",
    ]);
  });

  it("draws a single continuous lane path for the commit's own column", async () => {
    // Linear-history rows should emit ONE path that traverses from row top
    // through the dot to row bottom, not two half-row paths stitched at
    // mid-y (which leaves a visible seam at sub-pixel rendering).
    const commits: GitCommit[] = [
      makeCommit({
        sha: "c2",
        parents: ["c1"],
        lane: 0,
        colorId: 0,
        inputSwimlanes: [makeSwimlane(0, "c2")],
        outputSwimlanes: [makeSwimlane(0, "c1")],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const paths = row.querySelectorAll("svg path");
    expect(paths).toHaveLength(1);
    // Single full-row vertical (x1==x2) -> "M<x> 0V<rowHeight>"
    expect(paths[0].getAttribute("d")).toMatch(/^M[\d.]+ 0V[\d.]+$/);
  });

  it("primary's continuing lane stays in its own column even when an unrelated input shares the snapshot", async () => {
    // Regression for a real-world detour: at a side-branch commit, parser
    // sets `next[matchedLanes[0]] = { color, exp: firstParent }`. If another
    // input lane (color rotation collision + shared ancestor) holds the SAME
    // snapshot as that new value, a findIndex-based search picks the leftmost
    // match -- routing the primary's continuing path across the entire row to
    // a column it doesn't belong in. The primary must stay in its own column.
    const commits: GitCommit[] = [
      makeCommit({
        sha: "c",
        parents: ["P"],
        lane: 2,
        colorId: 0,
        inputSwimlanes: [
          makeSwimlane(0, "P"), // unrelated lane already waiting for P
          makeSwimlane(1, "X"),
          makeSwimlane(0, "c"), // primary, matches commit
        ],
        outputSwimlanes: [
          makeSwimlane(0, "P"), // unrelated lane unchanged
          makeSwimlane(1, "X"),
          makeSwimlane(0, "P"), // primary's new state -- IDENTICAL to output[0]
        ],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const paths = Array.from(row.querySelectorAll("svg path")).map(
      (p) => p.getAttribute("d") ?? "",
    );
    // Primary's stitched path must be a vertical at the dot's column (lane 2 ->
    // x=38). Without the fix, it curves from x=38 to x=6 (long detour).
    expect(paths).toContain("M38 0V22");
    // Unrelated input 0 stays straight at its column.
    expect(paths).toContain("M6 0V22");
    // Lane 1 stays straight at its column.
    expect(paths).toContain("M22 0V22");
  });

  it("merge sinks render top-half only, never overlap the primary lane below the dot", async () => {
    // A side branch terminating at a merge commit should curve INTO the dot
    // and stop there. Before the fix, the sink's color was drawn through the
    // bottom half of the row too, painting over the primary lane.
    const commits: GitCommit[] = [
      makeCommit({
        sha: "merge",
        parents: ["main-parent"],
        lane: 0,
        colorId: 0,
        // Two input lanes, both expecting the merge commit. Lane 0 is the
        // primary (same colorId), lane 1 is the merge sink (different colorId).
        inputSwimlanes: [makeSwimlane(0, "merge"), makeSwimlane(2, "merge")],
        outputSwimlanes: [makeSwimlane(0, "main-parent")],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const paths = Array.from(row.querySelectorAll("svg path"));
    const sinkPath = paths.find(
      (p) => p.getAttribute("stroke") === "var(--theme-graph-branch-3)",
    );
    expect(sinkPath).toBeTruthy();
    // The sink path must end at the dot's mid-y (= 11 for desktop rowHeight 22),
    // not extend to row bottom (22).
    const d = sinkPath?.getAttribute("d") ?? "";
    expect(d).toContain("11");
    // No bottom-half segment: must not contain a coordinate ending at y=22.
    expect(d).not.toMatch(/\b22\s*$/);
  });

  it("draws bottom-half for a brand-new lane even when its snapshot collides with an unrelated input", async () => {
    // Real bug from the wild: at a side-branch tip commit, a fresh lane is
    // opened in output. If color rotation gives that lane the same colorId as
    // an unrelated active input, AND both lanes happen to wait for the same
    // ancestor (common when the branch's first parent IS on main), the input
    // and output snapshots are byte-equal. The previous case-3 guard
    // `inputSwimlanes.some(s => snapshotsMatch(s, t))` then falsely shadowed
    // the new output, leaving the dot floating with no connector beneath.
    const commits: GitCommit[] = [
      makeCommit({
        sha: "tip",
        // First parent shared with the unrelated input lane -> identical snapshot.
        parents: ["P"],
        lane: 1,
        colorId: 0,
        // No input lane waits for this commit (matchedLanes=[] case).
        inputSwimlanes: [makeSwimlane(0, "P")],
        // Output: input passes through at idx 0 + new lane at idx 1, byte-equal
        // snapshot to the input.
        outputSwimlanes: [makeSwimlane(0, "P"), makeSwimlane(0, "P")],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const paths = Array.from(row.querySelectorAll("svg path")).map(
      (p) => p.getAttribute("d") ?? "",
    );
    // Two paths required: input passing through at lane 0, AND fresh lane 1
    // bottom-half from the dot down. Without the fix, only the first appears.
    expect(paths).toContain("M6 0V22");
    expect(paths).toContain("M22 11V22");
  });

  it("classifies primary by index, not colorId, so rotated colors don't double-stitch", async () => {
    // BRANCH_COLOR_COUNT=5: with 6+ active branches the rotation gives unrelated
    // lanes the same colorId. At a merge row where two input lanes happen to
    // share colorId with the commit, a colorId-based isPrimary check would
    // mark BOTH as primary and emit duplicate stitched paths through the dot --
    // visually breaking the line. parseGitLog uses matchedLanes[0] (leftmost
    // index) as the primary, so the renderer must mirror that.
    const commits: GitCommit[] = [
      makeCommit({
        sha: "merge",
        parents: ["main-parent"],
        lane: 0,
        colorId: 0,
        // Two input lanes both expecting the merge AND both colorId=0 (the
        // collision case). Lane 0 is primary (leftmost), lane 1 is sink.
        inputSwimlanes: [makeSwimlane(0, "merge"), makeSwimlane(0, "merge")],
        outputSwimlanes: [makeSwimlane(0, "main-parent")],
      }),
    ];
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const row = await findByTestId("git-graph-commit-row");
    const paths = Array.from(row.querySelectorAll("svg path"));
    // Exactly one stitched (full-row) path -- the primary. The sink terminates
    // at the dot (top-half only), so its path must not reach y=22.
    // A full-row path ENDS at y=22 (e.g. "...V22" or "... 6 22"). Sink paths
    // end at y=11 (mid). Anchoring at end avoids matching x-coords like "M22 0".
    const fullRowPaths = paths.filter((p) => {
      const d = p.getAttribute("d") ?? "";
      return /22$/.test(d);
    });
    expect(fullRowPaths).toHaveLength(1);
  });

  it("sizes SVG width per row based on that row's max lane", async () => {
    // Each row uses progressively more lanes -- width should scale per-row,
    // not balloon every row to the deepest of the page (would push subjects
    // right unnecessarily on linear-history rows).
    const commits: GitCommit[] = Array.from({ length: 4 }, (_, i) =>
      makeCommit({
        sha: `c${i}`,
        lane: i,
        colorId: i,
        outputSwimlanes: Array.from({ length: i + 1 }, (_, k) =>
          makeSwimlane(k, `parent-${k}`),
        ),
      }),
    );
    global.fetch = mockGitLog(commits) as unknown as typeof fetch;
    const { findAllByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const rows = await findAllByTestId("git-graph-commit-row");
    const widths = rows.map((r) =>
      Number(r.querySelector("svg")?.getAttribute("width")),
    );
    // Row i has max lane = i; width = 6 + i*16 + 6.
    expect(widths).toEqual([12, 28, 44, 60]);
  });

  it("renders an include-remotes toggle and persists state to localStorage", async () => {
    window.localStorage.clear();
    const calls: URL[] = [];
    global.fetch = vi.fn(async (url) => {
      calls.push(new URL(url as string, "http://test.local"));
      return {
        ok: true,
        status: 200,
        json: async () => ({ commits: [], hasUncommitted: false }),
      } as Response;
    }) as unknown as typeof fetch;
    const { findByTestId } = render(
      <GitGraphPane
        projectId="p"
        worktreePath="/repo-A"
        selection={null}
        onSelect={() => {}}
      />,
    );
    const toggle = await findByTestId("git-graph-toggle-remotes");
    // Default ON -> first fetch carries includeRemotes=1
    await waitFor(() => {
      expect(calls.length).toBeGreaterThan(0);
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const firstUrl = calls[0];
    expect(firstUrl.searchParams.get("includeRemotes")).toBe("1");

    // Click toggle -> OFF -> next fetch drops the param + persists "0"
    toggle.click();
    await waitFor(() => {
      const last = calls[calls.length - 1];
      expect(last.searchParams.has("includeRemotes")).toBe(false);
    });
    expect(window.localStorage.getItem("gitGraph:includeRemotes:/repo-A")).toBe(
      "0",
    );
  });
});
