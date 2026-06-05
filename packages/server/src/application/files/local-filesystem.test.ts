import { describe, expect, it, vi } from "vitest";
import {
  FileAccessError,
  FileExistsError,
  FileNotFoundError,
  FileReadError,
  FileWriteError,
  UnsupportedPlatformError,
} from "./errors.js";
import {
  createLocalFilesystem,
  InvalidDirectoryNameError,
} from "./local-filesystem.js";

describe("createLocalFilesystem", () => {
  it("browses directories within the home directory", () => {
    const filesystem = createLocalFilesystem({
      browseHomeDirectories: vi.fn((targetPath: string) => [
        {
          name: "code",
          path: `${targetPath}/code`,
          type: "directory" as const,
        },
      ]),
      getHomeDir: () => "/Users/test",
      normalizePath: (path: string) => path,
    });

    expect(filesystem.browseDirectories("~/projects")).toEqual({
      path: "/Users/test/projects",
      parent: "/Users/test",
      entries: [
        {
          name: "code",
          path: "/Users/test/projects/code",
          type: "directory",
        },
      ],
    });
  });

  it("rejects paths outside the home directory", () => {
    const filesystem = createLocalFilesystem({
      getHomeDir: () => "/Users/test",
      normalizePath: (path: string) => path,
    });

    expect(() => filesystem.browseDirectories("/tmp")).toThrow(FileAccessError);
  });

  it("maps normalization failures to read errors", () => {
    const filesystem = createLocalFilesystem({
      getHomeDir: () => "/Users/test",
      normalizePath: () => {
        throw new Error("boom");
      },
    });

    expect(() => filesystem.browseDirectories("~/broken")).toThrow(
      FileReadError,
    );
  });

  it("returns the chosen folder path", async () => {
    const filesystem = createLocalFilesystem({
      getPlatform: () => "darwin",
      pickFolder: vi.fn(async () => "/Users/test/project"),
    });

    await expect(filesystem.pickProjectFolder()).resolves.toBe(
      "/Users/test/project",
    );
  });

  it("treats picker failures as cancellation", async () => {
    const filesystem = createLocalFilesystem({
      getPlatform: () => "linux",
      pickFolder: vi.fn(async () => {
        throw new Error("cancelled");
      }),
    });

    await expect(filesystem.pickProjectFolder()).resolves.toBeNull();
  });

  it("surfaces unsupported platforms", async () => {
    const filesystem = createLocalFilesystem({
      getPlatform: () => "win32",
      pickFolder: vi.fn(async () => {
        throw new UnsupportedPlatformError();
      }),
    });

    await expect(filesystem.pickProjectFolder()).rejects.toBeInstanceOf(
      UnsupportedPlatformError,
    );
  });

  describe("createProjectDirectory", () => {
    function makeFs(
      overrides: Parameters<typeof createLocalFilesystem>[0] = {},
    ) {
      const parentDir = "/Users/test/projects";
      return createLocalFilesystem({
        getHomeDir: () => "/Users/test",
        normalizePath: (path: string) => path,
        statPath: (p: string) =>
          p === parentDir ? { isDirectory: true } : null,
        checkWritable: () => true,
        createDirectory: vi.fn(),
        ...overrides,
      });
    }

    it("creates a directory under the parent and returns the target path", () => {
      const createDirectory = vi.fn();
      const filesystem = makeFs({ createDirectory });

      const result = filesystem.createProjectDirectory({
        parent: "~/projects",
        name: "new-app",
      });

      expect(result).toEqual({ path: "/Users/test/projects/new-app" });
      expect(createDirectory).toHaveBeenCalledWith(
        "/Users/test/projects/new-app",
      );
    });

    it("trims surrounding whitespace from the name", () => {
      const createDirectory = vi.fn();
      const filesystem = makeFs({ createDirectory });

      filesystem.createProjectDirectory({
        parent: "~/projects",
        name: "  spaced  ",
      });

      expect(createDirectory).toHaveBeenCalledWith(
        "/Users/test/projects/spaced",
      );
    });

    it("rejects empty / whitespace-only names", () => {
      const filesystem = makeFs();

      expect(() =>
        filesystem.createProjectDirectory({ parent: "~/projects", name: "  " }),
      ).toThrow(InvalidDirectoryNameError);
    });

    it("rejects '.' and '..' names", () => {
      const filesystem = makeFs();

      expect(() =>
        filesystem.createProjectDirectory({ parent: "~/projects", name: "." }),
      ).toThrow(InvalidDirectoryNameError);
      expect(() =>
        filesystem.createProjectDirectory({ parent: "~/projects", name: ".." }),
      ).toThrow(InvalidDirectoryNameError);
    });

    it("rejects names containing path separators", () => {
      const filesystem = makeFs();

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "a/b",
        }),
      ).toThrow(InvalidDirectoryNameError);
    });

    it("rejects parents outside HOME", () => {
      const filesystem = makeFs();

      expect(() =>
        filesystem.createProjectDirectory({ parent: "/tmp", name: "x" }),
      ).toThrow(FileAccessError);
    });

    it("maps missing parent to FileNotFoundError", () => {
      const filesystem = makeFs({
        statPath: () => null,
      });

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "x",
        }),
      ).toThrow(FileNotFoundError);
    });

    it("maps non-directory parent to FileNotFoundError", () => {
      const filesystem = makeFs({
        statPath: () => ({ isDirectory: false }),
      });

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "x",
        }),
      ).toThrow(FileNotFoundError);
    });

    it("maps non-writable parent to FileAccessError", () => {
      const filesystem = makeFs({
        checkWritable: () => false,
      });

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "x",
        }),
      ).toThrow(FileAccessError);
    });

    it("maps existing target to FileExistsError", () => {
      const filesystem = makeFs({
        statPath: (path: string) =>
          path === "/Users/test/projects/x"
            ? { isDirectory: true }
            : { isDirectory: true },
      });

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "x",
        }),
      ).toThrow(FileExistsError);
    });

    it("maps EACCES from createDirectory to FileAccessError", () => {
      const filesystem = makeFs({
        statPath: (path: string) =>
          path === "/Users/test/projects" ? { isDirectory: true } : null,
        createDirectory: () => {
          const err = new Error("permission denied") as NodeJS.ErrnoException;
          err.code = "EACCES";
          throw err;
        },
      });

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "x",
        }),
      ).toThrow(FileAccessError);
    });

    it("maps generic createDirectory failure to FileWriteError", () => {
      const filesystem = makeFs({
        statPath: (path: string) =>
          path === "/Users/test/projects" ? { isDirectory: true } : null,
        createDirectory: () => {
          throw new Error("disk full");
        },
      });

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "x",
        }),
      ).toThrow(FileWriteError);
    });

    it("maps EEXIST from createDirectory to FileExistsError", () => {
      const filesystem = makeFs({
        statPath: (path: string) =>
          path === "/Users/test/projects" ? { isDirectory: true } : null,
        createDirectory: () => {
          const err = new Error("already") as NodeJS.ErrnoException;
          err.code = "EEXIST";
          throw err;
        },
      });

      expect(() =>
        filesystem.createProjectDirectory({
          parent: "~/projects",
          name: "x",
        }),
      ).toThrow(FileExistsError);
    });
  });
});
