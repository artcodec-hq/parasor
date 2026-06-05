import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FilesystemService } from "../../fs/service.js";
import type { ProjectManager } from "../../state/project-manager.js";
import { WorkspaceNotFoundError } from "../workspace/errors.js";
import {
  FileAccessError,
  FileNotFoundError,
  FileReadError,
  FilesystemUnavailableError,
  FileTooLargeError,
} from "./errors.js";
import { createProjectFileQueries } from "./project-file-queries.js";

describe("createProjectFileQueries", () => {
  let projects: Map<string, { id: string; path: string; name: string }>;
  let projectManager: ProjectManager;
  let service: FilesystemService;
  let getFilesystemService: (projectId: string) => FilesystemService | null;

  beforeEach(() => {
    projects = new Map();
    projects.set("proj-1", {
      id: "proj-1",
      path: "/tmp/proj",
      name: "proj",
    });

    projectManager = {
      get: vi.fn((id: string) => projects.get(id)),
    } as unknown as ProjectManager;

    service = {
      listDir: vi.fn(async () => [
        { name: "src", path: "src", type: "directory", isGitignored: false },
      ]),
      readFile: vi.fn(async () => "contents"),
    } as unknown as FilesystemService;

    getFilesystemService = vi.fn((projectId: string) =>
      projects.has(projectId) ? service : null,
    );
  });

  it("lists project directories", async () => {
    const queries = createProjectFileQueries({
      getFilesystemService,
      projectManager,
    });

    await expect(queries.listProjectDirectory("proj-1")).resolves.toEqual([
      { name: "src", path: "src", type: "directory", isGitignored: false },
    ]);
    expect(service.listDir).toHaveBeenCalledWith(".");
  });

  it("reads project files", async () => {
    const queries = createProjectFileQueries({
      getFilesystemService,
      projectManager,
    });

    await expect(
      queries.readProjectFile("proj-1", "src/index.ts"),
    ).resolves.toBe("contents");
  });

  it("throws when the project is missing", async () => {
    const queries = createProjectFileQueries({
      getFilesystemService,
      projectManager,
    });

    await expect(
      queries.listProjectDirectory("missing"),
    ).rejects.toBeInstanceOf(WorkspaceNotFoundError);
  });

  it("throws when the filesystem service is unavailable", async () => {
    const queries = createProjectFileQueries({
      getFilesystemService: () => null,
      projectManager,
    });

    await expect(queries.listProjectDirectory("proj-1")).rejects.toBeInstanceOf(
      FilesystemUnavailableError,
    );
  });

  it("maps path traversal to access denied", async () => {
    const error = new Error("Path traversal denied");
    error.name = "PathTraversalError";
    vi.mocked(service.listDir).mockRejectedValueOnce(error);
    const queries = createProjectFileQueries({
      getFilesystemService,
      projectManager,
    });

    await expect(
      queries.listProjectDirectory("proj-1", "../../etc"),
    ).rejects.toBeInstanceOf(FileAccessError);
  });

  it("maps missing files", async () => {
    vi.mocked(service.readFile).mockResolvedValueOnce(null);
    const queries = createProjectFileQueries({
      getFilesystemService,
      projectManager,
    });

    await expect(
      queries.readProjectFile("proj-1", "missing.ts"),
    ).rejects.toBeInstanceOf(FileNotFoundError);
  });

  it("maps oversized files", async () => {
    vi.mocked(service.readFile).mockRejectedValueOnce(
      new Error("File too large"),
    );
    const queries = createProjectFileQueries({
      getFilesystemService,
      projectManager,
    });

    await expect(
      queries.readProjectFile("proj-1", "huge.bin"),
    ).rejects.toBeInstanceOf(FileTooLargeError);
  });

  it("maps unknown read errors", async () => {
    vi.mocked(service.readFile).mockRejectedValueOnce(new Error("boom"));
    const queries = createProjectFileQueries({
      getFilesystemService,
      projectManager,
    });

    await expect(
      queries.readProjectFile("proj-1", "src/index.ts"),
    ).rejects.toBeInstanceOf(FileReadError);
  });
});
