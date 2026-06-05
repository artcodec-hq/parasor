import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "./auth-fetch.js";
import {
  fetchDiff,
  fetchIdeCommands,
  fetchLocalIdeCapability,
  openWorktreeInIde,
  updateIdeCommands,
} from "./git-api.js";

vi.mock("./auth-fetch.js", () => ({
  authFetch: vi.fn(),
}));

const authFetchMock = vi.mocked(authFetch);

describe("git-api", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });

  it("posts the selected IDE launcher request", async () => {
    await openWorktreeInIde({
      projectId: "project/1",
      worktreePath: "/repo",
      editor: "cursor",
    });

    expect(authFetchMock).toHaveBeenCalledWith(
      "/api/projects/project%2F1/worktrees/open-ide",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: "/repo", editor: "cursor" }),
      },
    );
  });

  it("fetches local IDE capability", async () => {
    authFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ canOpenLocalIde: true })),
    );

    await expect(fetchLocalIdeCapability()).resolves.toEqual({
      canOpenLocalIde: true,
    });

    expect(authFetchMock).toHaveBeenCalledWith(
      "/api/projects/local-ide-capability",
    );
  });

  it("fetches and updates IDE commands", async () => {
    const commands = [
      { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
    ];
    authFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ commands })),
    );
    await expect(fetchIdeCommands()).resolves.toEqual(commands);
    expect(authFetchMock).toHaveBeenCalledWith("/api/ide-commands");

    authFetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ commands })),
    );
    await expect(updateIdeCommands(commands)).resolves.toEqual(commands);
    expect(authFetchMock).toHaveBeenLastCalledWith("/api/ide-commands", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ commands }),
    });
  });
  describe("fetchDiff", () => {
    it("GETs the working-tree diff, forwards the signal, and returns the diff", async () => {
      const signal = new AbortController().signal;
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ diff: "@@ patch @@" })),
      );

      await expect(
        fetchDiff({ projectId: "proj/1", worktreePath: "/repo" }, signal),
      ).resolves.toBe("@@ patch @@");

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/projects/proj%2F1/diff?worktreePath=%2Frepo",
        { signal },
      );
    });

    it("appends sha when provided (commit diff)", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ diff: "x" })),
      );

      await fetchDiff({
        projectId: "p1",
        worktreePath: "/repo",
        sha: "abc123",
      });

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/projects/p1/diff?sha=abc123&worktreePath=%2Frepo",
        { signal: undefined },
      );
    });

    it("returns null when the response is not ok", async () => {
      authFetchMock.mockResolvedValueOnce(new Response("", { status: 500 }));

      await expect(
        fetchDiff({ projectId: "p1", worktreePath: "/repo" }),
      ).resolves.toBeNull();
    });
  });
});
