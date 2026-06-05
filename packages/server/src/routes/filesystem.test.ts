import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import {
  FileAccessError,
  FileExistsError,
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  UnsupportedPlatformError,
} from "../application/files/errors.js";
import { InvalidDirectoryNameError } from "../application/files/local-filesystem.js";
import { createFilesystemRoutes } from "./filesystem.js";

function createApp() {
  const filesystem = {
    browseDirectories: vi.fn(() => ({
      path: "/Users/test/projects",
      parent: "/Users/test",
      entries: [
        {
          name: "parasor",
          path: "/Users/test/projects/parasor",
          type: "directory" as const,
        },
      ],
    })),
    pickProjectFolder: vi.fn(
      async (): Promise<string | null> => "/Users/test/projects/parasor",
    ),
    createProjectDirectory: vi.fn(
      ({ parent, name }: { parent: string; name: string }) => ({
        path: `${parent.replace(/\/$/, "")}/${name}`,
      }),
    ),
  } satisfies NonNullable<Parameters<typeof createFilesystemRoutes>[0]>;

  const app = new Hono();
  app.route("/api/fs", createFilesystemRoutes(filesystem));
  return { app, filesystem };
}

function postJson(app: Hono, path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("filesystem routes", () => {
  it("browses home directories", async () => {
    const { app, filesystem } = createApp();

    const response = await app.request("/api/fs/browse?path=~/projects");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      path: "/Users/test/projects",
      parent: "/Users/test",
      entries: [
        {
          name: "parasor",
          path: "/Users/test/projects/parasor",
          type: "directory",
        },
      ],
    });
    expect(filesystem.browseDirectories).toHaveBeenCalledWith("~/projects");
  });

  it("maps browse access errors", async () => {
    const { app, filesystem } = createApp();
    filesystem.browseDirectories.mockImplementationOnce(() => {
      throw new FileAccessError();
    });

    const response = await app.request("/api/fs/browse?path=/tmp");

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Access denied" });
  });

  it("maps browse read errors", async () => {
    const { app, filesystem } = createApp();
    filesystem.browseDirectories.mockImplementationOnce(() => {
      throw new FileReadError("Cannot read directory");
    });

    const response = await app.request("/api/fs/browse?path=~/broken");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Cannot read directory",
    });
  });

  it("returns the chosen folder path", async () => {
    const { app } = createApp();

    const response = await app.request("/api/fs/pick-folder", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      path: "/Users/test/projects/parasor",
    });
  });

  it("returns cancelled when no folder is chosen", async () => {
    const { app, filesystem } = createApp();
    filesystem.pickProjectFolder.mockImplementationOnce(async () => null);

    const response = await app.request("/api/fs/pick-folder", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ cancelled: true });
  });

  it("maps unsupported platforms", async () => {
    const { app, filesystem } = createApp();
    filesystem.pickProjectFolder.mockRejectedValueOnce(
      new UnsupportedPlatformError(),
    );

    const response = await app.request("/api/fs/pick-folder", {
      method: "POST",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Unsupported platform",
    });
  });

  describe("mkdir", () => {
    it("creates a directory under the parent", async () => {
      const { app, filesystem } = createApp();

      const response = await postJson(app, "/api/fs/mkdir", {
        parent: "/Users/test/projects",
        name: "new-app",
      });

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({
        path: "/Users/test/projects/new-app",
      });
      expect(filesystem.createProjectDirectory).toHaveBeenCalledWith({
        parent: "/Users/test/projects",
        name: "new-app",
      });
    });

    it("rejects empty body", async () => {
      const { app } = createApp();
      const response = await app.request("/api/fs/mkdir", { method: "POST" });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Invalid JSON",
      });
    });

    it("rejects missing parent", async () => {
      const { app } = createApp();
      const response = await postJson(app, "/api/fs/mkdir", { name: "x" });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "parent is required",
      });
    });

    it("rejects missing name", async () => {
      const { app } = createApp();
      const response = await postJson(app, "/api/fs/mkdir", {
        parent: "/Users/test/projects",
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "name is required",
      });
    });

    it("maps invalid directory name", async () => {
      const { app, filesystem } = createApp();
      filesystem.createProjectDirectory.mockImplementationOnce(() => {
        throw new InvalidDirectoryNameError("Name is required");
      });

      const response = await postJson(app, "/api/fs/mkdir", {
        parent: "/Users/test/projects",
        name: "   ",
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: "Name is required",
      });
    });

    it("maps name collision to 409", async () => {
      const { app, filesystem } = createApp();
      filesystem.createProjectDirectory.mockImplementationOnce(() => {
        throw new FileExistsError("Directory already exists");
      });

      const response = await postJson(app, "/api/fs/mkdir", {
        parent: "/Users/test/projects",
        name: "parasor",
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({
        error: "Directory already exists",
      });
    });

    it("maps missing parent to 404", async () => {
      const { app, filesystem } = createApp();
      filesystem.createProjectDirectory.mockImplementationOnce(() => {
        throw new FileNotFoundError("Parent directory not found");
      });

      const response = await postJson(app, "/api/fs/mkdir", {
        parent: "/Users/test/missing",
        name: "x",
      });

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        error: "Parent directory not found",
      });
    });

    it("maps access denied to 403", async () => {
      const { app, filesystem } = createApp();
      filesystem.createProjectDirectory.mockImplementationOnce(() => {
        throw new FileAccessError("Parent directory is not writable");
      });

      const response = await postJson(app, "/api/fs/mkdir", {
        parent: "/Users/test/projects",
        name: "x",
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({
        error: "Parent directory is not writable",
      });
    });

    it("maps write error to 500", async () => {
      const { app, filesystem } = createApp();
      filesystem.createProjectDirectory.mockImplementationOnce(() => {
        throw new FileWriteError("disk full");
      });

      const response = await postJson(app, "/api/fs/mkdir", {
        parent: "/Users/test/projects",
        name: "x",
      });

      expect(response.status).toBe(500);
      await expect(response.json()).resolves.toEqual({ error: "disk full" });
    });
  });
});
