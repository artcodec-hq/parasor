import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "./auth-fetch.js";
import {
  copyFile,
  type FileListEntry,
  listDir,
  makeDirectory,
  readFile,
  statFile,
  writeFile,
} from "./files-api.js";

vi.mock("./auth-fetch.js", () => ({
  authFetch: vi.fn(),
}));

const authFetchMock = vi.mocked(authFetch);

describe("files-api", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValue(new Response("ok"));
  });

  describe("readFile", () => {
    it("GETs the file read endpoint and forwards the signal", async () => {
      const signal = new AbortController().signal;
      const res = new Response("file body");
      authFetchMock.mockResolvedValueOnce(res);

      await expect(
        readFile(
          { projectId: "p/1", path: "src/a.ts", worktreePath: "/wt" },
          signal,
        ),
      ).resolves.toBe(res);

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/files/read?projectId=p%2F1&path=src%2Fa.ts&worktreePath=%2Fwt",
        { signal },
      );
    });

    it("omits worktreePath when not provided and passes undefined signal", async () => {
      await readFile({ projectId: "p1", path: "a.ts" });

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/files/read?projectId=p1&path=a.ts",
        { signal: undefined },
      );
    });
  });

  describe("writeFile", () => {
    it("POSTs the write endpoint with JSON body including worktreePath", async () => {
      const res = new Response("", { status: 200 });
      authFetchMock.mockResolvedValueOnce(res);

      await expect(
        writeFile({
          projectId: "p1",
          path: "a.ts",
          content: "hello",
          worktreePath: "/wt",
        }),
      ).resolves.toBe(res);

      expect(authFetchMock).toHaveBeenCalledWith("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          path: "a.ts",
          content: "hello",
          worktreePath: "/wt",
        }),
      });
    });

    it("omits worktreePath from the body when not provided", async () => {
      await writeFile({ projectId: "p1", path: "a.ts", content: "x" });

      expect(authFetchMock).toHaveBeenCalledWith("/api/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "p1", path: "a.ts", content: "x" }),
      });
    });
  });

  describe("makeDirectory", () => {
    it("POSTs the mkdir endpoint with lowercase content-type and worktreePath", async () => {
      await makeDirectory({
        projectId: "p1",
        path: "newdir",
        worktreePath: "/wt",
      });

      expect(authFetchMock).toHaveBeenCalledWith("/api/files/mkdir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          path: "newdir",
          worktreePath: "/wt",
        }),
      });
    });

    it("omits worktreePath from the body when not provided", async () => {
      await makeDirectory({ projectId: "p1", path: "newdir" });

      expect(authFetchMock).toHaveBeenCalledWith("/api/files/mkdir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "p1", path: "newdir" }),
      });
    });
  });

  describe("copyFile", () => {
    it("POSTs the copy endpoint with lowercase content-type and worktreePath", async () => {
      const res = new Response("", { status: 200 });
      authFetchMock.mockResolvedValueOnce(res);

      await expect(
        copyFile({
          projectId: "p1",
          srcPath: "a.ts",
          destPath: "a copy.ts",
          worktreePath: "/wt",
        }),
      ).resolves.toBe(res);

      expect(authFetchMock).toHaveBeenCalledWith("/api/files/copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          srcPath: "a.ts",
          destPath: "a copy.ts",
          worktreePath: "/wt",
        }),
      });
    });

    it("omits worktreePath from the body when not provided", async () => {
      await copyFile({ projectId: "p1", srcPath: "a.ts", destPath: "b.ts" });

      expect(authFetchMock).toHaveBeenCalledWith("/api/files/copy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          srcPath: "a.ts",
          destPath: "b.ts",
        }),
      });
    });
  });

  describe("listDir", () => {
    it("GETs the list endpoint and returns the parsed entries", async () => {
      const entries: FileListEntry[] = [
        { name: "a.ts", path: "a.ts", type: "file" },
      ];
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ entries }), { status: 200 }),
      );

      await expect(
        listDir({ projectId: "p/1", path: ".", worktreePath: "/wt" }),
      ).resolves.toEqual(entries);

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/files/list?projectId=p%2F1&path=.&worktreePath=%2Fwt",
      );
    });

    it("omits worktreePath from the URL when not provided", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ entries: [] }), { status: 200 }),
      );

      await listDir({ projectId: "p1", path: "src" });

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/files/list?projectId=p1&path=src",
      );
    });

    it("returns null when the response is not ok", async () => {
      authFetchMock.mockResolvedValueOnce(new Response("", { status: 404 }));

      await expect(listDir({ projectId: "p1", path: "." })).resolves.toBeNull();
    });
  });

  describe("statFile", () => {
    it("GETs the stat endpoint and forwards the signal", async () => {
      const signal = new AbortController().signal;
      const res = new Response(JSON.stringify({ size: 1 }), { status: 200 });
      authFetchMock.mockResolvedValueOnce(res);

      await expect(
        statFile(
          { projectId: "p/1", path: "a.png", worktreePath: "/wt" },
          signal,
        ),
      ).resolves.toBe(res);

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/files/stat?projectId=p%2F1&path=a.png&worktreePath=%2Fwt",
        { signal },
      );
    });

    it("omits worktreePath when not provided and passes undefined signal", async () => {
      await statFile({ projectId: "p1", path: "a.png" });

      expect(authFetchMock).toHaveBeenCalledWith(
        "/api/files/stat?projectId=p1&path=a.png",
        { signal: undefined },
      );
    });
  });
});
