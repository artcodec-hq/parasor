import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FilesystemService, PathTraversalError } from "./service.js";

describe("FilesystemService", () => {
  let root: string;
  let service: FilesystemService;

  beforeEach(() => {
    root = join(tmpdir(), `parasor-fs-test-${Date.now()}`);
    mkdirSync(join(root, "src", "lib"), { recursive: true });
    mkdirSync(join(root, "node_modules", "lodash"), { recursive: true });
    mkdirSync(join(root, ".git", "refs"), { recursive: true });
    mkdirSync(join(root, "dist"), { recursive: true });
    writeFileSync(join(root, "package.json"), "{}");
    writeFileSync(join(root, "src", "index.ts"), "export {};");
    writeFileSync(join(root, "src", "lib", "utils.ts"), "export {};");
    writeFileSync(join(root, ".DS_Store"), "");
    writeFileSync(join(root, ".gitignore"), "node_modules\ndist\n");
    service = new FilesystemService(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe("listDir", () => {
    it("lists root directory entries", async () => {
      const entries = await service.listDir(".");
      const names = entries.map((e) => e.name);
      expect(names).not.toContain(".git");
      expect(names).not.toContain(".DS_Store");
      expect(names).toContain("src");
      expect(names).toContain("package.json");
      expect(names).toContain(".gitignore");
    });

    it("marks gitignored entries", async () => {
      const entries = await service.listDir(".");
      const nodeModules = entries.find((e) => e.name === "node_modules");
      const dist = entries.find((e) => e.name === "dist");
      expect(nodeModules?.isGitignored).toBe(true);
      expect(dist?.isGitignored).toBe(true);
    });

    it("marks dotfiles as hidden", async () => {
      const entries = await service.listDir(".");
      const gitignore = entries.find((e) => e.name === ".gitignore");
      expect(gitignore?.isHidden).toBe(true);
    });

    it("lists subdirectory contents", async () => {
      const entries = await service.listDir("src");
      const names = entries.map((e) => e.name);
      expect(names).toContain("index.ts");
      expect(names).toContain("lib");
    });

    it("returns correct types for files and directories", async () => {
      const entries = await service.listDir("src");
      const indexTs = entries.find((e) => e.name === "index.ts");
      const lib = entries.find((e) => e.name === "lib");
      expect(indexTs?.type).toBe("file");
      expect(lib?.type).toBe("directory");
    });

    it("sorts directories before files, then alphabetical", async () => {
      const entries = await service.listDir("src");
      const types = entries.map((e) => e.type);
      const dirIdx = types.indexOf("directory");
      const fileIdx = types.indexOf("file");
      if (dirIdx !== -1 && fileIdx !== -1) {
        expect(dirIdx).toBeLessThan(fileIdx);
      }
    });
  });

  describe("path security", () => {
    it("rejects path traversal with ..", async () => {
      await expect(service.listDir("../")).rejects.toThrow("Path traversal");
    });

    it("rejects absolute paths outside project", async () => {
      await expect(service.listDir("/etc")).rejects.toThrow("Path traversal");
    });

    it("accepts nested relative paths", async () => {
      const entries = await service.listDir("src/lib");
      expect(entries.map((e) => e.name)).toContain("utils.ts");
    });
  });

  describe("readFile", () => {
    it("reads file content", async () => {
      const content = await service.readFile("package.json");
      expect(content).toBe("{}");
    });

    it("rejects path traversal", async () => {
      await expect(service.readFile("../../etc/passwd")).rejects.toThrow(
        "Path traversal",
      );
    });

    it("rejects files exceeding max size", async () => {
      const bigContent = "x".repeat(1024 * 1024 + 1);
      writeFileSync(join(root, "big.txt"), bigContent);
      await expect(service.readFile("big.txt")).rejects.toThrow(
        "File too large",
      );
    });

    it("returns null for non-existent file", async () => {
      const content = await service.readFile("does-not-exist.ts");
      expect(content).toBeNull();
    });
  });

  describe("writeFile", () => {
    it("writes content to existing file", async () => {
      await service.writeFile("package.json", '{"name":"x"}');
      const content = await service.readFile("package.json");
      expect(content).toBe('{"name":"x"}');
    });

    it("creates a new file in existing directory", async () => {
      await service.writeFile("src/new.ts", "export const x = 1;");
      const content = await service.readFile("src/new.ts");
      expect(content).toBe("export const x = 1;");
    });

    it("rejects path traversal", async () => {
      await expect(service.writeFile("../../etc/evil", "x")).rejects.toThrow(
        "Path traversal",
      );
    });

    it("rejects content exceeding max size", async () => {
      const big = "x".repeat(1024 * 1024 + 1);
      await expect(service.writeFile("too-big.txt", big)).rejects.toThrow(
        "File too large",
      );
    });

    it("rejects write to missing directory", async () => {
      await expect(
        service.writeFile("does/not/exist/file.ts", "x"),
      ).rejects.toThrow();
    });
  });

  describe("cp", () => {
    it("copies a file to a new path", async () => {
      await service.cp("package.json", "package copy.json");
      expect(readFileSync(join(root, "package copy.json"), "utf-8")).toBe("{}");
    });

    it("copies a directory recursively", async () => {
      await service.cp("src", "src copy");
      expect(readFileSync(join(root, "src copy", "index.ts"), "utf-8")).toBe(
        "export {};",
      );
      expect(
        readFileSync(join(root, "src copy", "lib", "utils.ts"), "utf-8"),
      ).toBe("export {};");
    });

    it("rejects when destination already exists", async () => {
      writeFileSync(join(root, "dest.txt"), "existing");
      await expect(
        service.cp("package.json", "dest.txt"),
      ).rejects.toMatchObject({ name: "CopyDestinationExistsError" });
    });

    it("rejects when source is missing", async () => {
      await expect(
        service.cp("missing.txt", "missing copy.txt"),
      ).rejects.toMatchObject({ name: "CopySourceNotFoundError" });
    });

    it("rejects path traversal on source", async () => {
      await expect(service.cp("../../etc/passwd", "x.txt")).rejects.toThrow(
        "Path traversal",
      );
    });

    it("rejects path traversal on destination", async () => {
      await expect(
        service.cp("package.json", "../../escape.json"),
      ).rejects.toThrow("Path traversal");
    });
  });

  describe("openInlineFile", () => {
    it("opens a regular file and reports stats", async () => {
      writeFileSync(join(root, "media.bin"), Buffer.from([0, 1, 2, 3]));
      const opened = await service.openInlineFile("media.bin");
      expect(opened).not.toBeNull();
      try {
        expect(opened?.stats.isFile()).toBe(true);
        expect(opened?.stats.size).toBe(4);
      } finally {
        await opened?.handle.close();
      }
    });

    it("returns null when the file is missing", async () => {
      const opened = await service.openInlineFile("nope.bin");
      expect(opened).toBeNull();
    });

    it("rejects a symlink leaf that escapes the project root", async () => {
      writeFileSync(join(root, "outside-target"), "secret");
      symlinkSync(join(root, "outside-target"), join(root, "leaf-link.png"));
      // O_NOFOLLOW raises ELOOP at the leaf -- surfaces as PathTraversalError.
      await expect(service.openInlineFile("leaf-link.png")).rejects.toThrow(
        PathTraversalError,
      );
    });

    it("rejects a non-regular file (FIFO) without blocking", async () => {
      // Ensures O_NONBLOCK is in effect: opening a *.mp4 FIFO must return
      // immediately and the post-open isFile() check must reject it.
      const fifoPath = join(root, "blocker.mp4");
      try {
        execFileSync("mkfifo", [fifoPath]);
      } catch {
        // mkfifo unavailable on this platform -- skip rather than hang.
        return;
      }
      const opened = await Promise.race([
        service.openInlineFile("blocker.mp4"),
        new Promise<"timeout">((resolve) =>
          setTimeout(() => resolve("timeout"), 1000),
        ),
      ]);
      expect(opened).toBeNull();
    });
  });
});
