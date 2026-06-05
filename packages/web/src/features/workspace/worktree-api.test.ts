import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "../../lib/auth-fetch.js";
import {
  createWorktree,
  loadWorktreeLocalFiles,
  refreshWorktrees,
} from "./worktree-api.js";

vi.mock("../../lib/auth-fetch.js", () => ({
  authFetch: vi.fn(),
}));

const authFetchMock = vi.mocked(authFetch);

describe("worktree-api", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });

  describe("createWorktree", () => {
    it("posts only the branch when optional fields are empty", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ path: "/wt" })),
      );

      await expect(
        createWorktree("p1", {
          branch: "feat",
          base: "",
          copyLocalFiles: [],
          rememberLocalFiles: false,
        }),
      ).resolves.toEqual({ path: "/wt", localFileCopies: undefined });

      expect(authFetchMock).toHaveBeenCalledWith("/api/projects/p1/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch: "feat" }),
      });
    });

    it("includes base, copyLocalFiles, and rememberLocalFiles when present", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ path: "/wt", localFileCopies: [] })),
      );

      await createWorktree("p1", {
        branch: "feat",
        base: "main",
        copyLocalFiles: [".env"],
        rememberLocalFiles: true,
      });

      expect(authFetchMock).toHaveBeenCalledWith("/api/projects/p1/worktrees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch: "feat",
          base: "main",
          copyLocalFiles: [".env"],
          rememberLocalFiles: true,
        }),
      });
    });

    it("throws the server error on a non-ok response", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "boom" }), { status: 400 }),
      );

      await expect(
        createWorktree("p1", {
          branch: "feat",
          base: "",
          copyLocalFiles: [],
          rememberLocalFiles: false,
        }),
      ).rejects.toThrow("boom");
    });

    it("throws a status fallback when the error body is unparseable", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response("not json", { status: 503 }),
      );

      await expect(
        createWorktree("p1", {
          branch: "feat",
          base: "",
          copyLocalFiles: [],
          rememberLocalFiles: false,
        }),
      ).rejects.toThrow("Request failed (503)");
    });

    it("throws when the response is missing a path", async () => {
      authFetchMock.mockResolvedValueOnce(new Response(JSON.stringify({})));

      await expect(
        createWorktree("p1", {
          branch: "feat",
          base: "",
          copyLocalFiles: [],
          rememberLocalFiles: false,
        }),
      ).rejects.toThrow("Worktree response missing path");
    });
  });

  describe("loadWorktreeLocalFiles", () => {
    it("gets the encoded project endpoint and returns the parsed body", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ candidates: [], rememberedPaths: [".env"] }),
        ),
      );

      await expect(loadWorktreeLocalFiles("a/b")).resolves.toEqual({
        candidates: [],
        rememberedPaths: [".env"],
      });

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/projects/a%2Fb/worktree-local-files",
      );
    });

    it("throws the server error on a non-ok response", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "nope" }), { status: 404 }),
      );

      await expect(loadWorktreeLocalFiles("p1")).rejects.toThrow("nope");
    });

    it("throws a status fallback when the error body is unparseable", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response("not json", { status: 500 }),
      );

      await expect(loadWorktreeLocalFiles("p1")).rejects.toThrow(
        "Request failed (500)",
      );
    });
  });

  describe("refreshWorktrees", () => {
    it("gets the worktrees endpoint forwarding the abort signal", async () => {
      const controller = new AbortController();

      await refreshWorktrees("p1", controller.signal);

      expect(authFetchMock).toHaveBeenCalledWith("/api/projects/p1/worktrees", {
        signal: controller.signal,
      });
    });
  });
});
