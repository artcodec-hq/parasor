import type { PathLike } from "node:fs";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyWorktreeLocalFiles,
  listWorktreeLocalFileCandidates,
} from "./worktree-local-files.js";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "parasor-wt-files-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.resetAllMocks();
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failure
    }
  }
});

describe("listWorktreeLocalFileCandidates", () => {
  it("returns ignored local config regular files without contents", async () => {
    const root = tempDir();
    mkdirSync(path.join(root, "apps/api"), { recursive: true });
    mkdirSync(path.join(root, "node_modules/pkg"), { recursive: true });
    writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    writeFileSync(path.join(root, "apps/api/.env.local"), "API_SECRET=1\n");
    writeFileSync(path.join(root, "README.md"), "tracked\n");
    writeFileSync(path.join(root, "node_modules/pkg/.env"), "ignored\n");

    const isIgnored = vi.fn(
      async (_projectPath: string, rel: string) =>
        rel === ".env" || rel === "apps/api/.env.local",
    );

    await expect(
      listWorktreeLocalFileCandidates(root, { isIgnored }),
    ).resolves.toEqual([
      { path: ".env", size: 9 },
      { path: "apps/api/.env.local", size: 13 },
    ]);
  });
});

describe("copyWorktreeLocalFiles", () => {
  it("copies selected ignored files without overwriting destinations", async () => {
    const root = tempDir();
    const worktree = tempDir();
    mkdirSync(path.join(root, "apps/api"), { recursive: true });
    mkdirSync(path.join(worktree, "apps/api"), { recursive: true });
    writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    writeFileSync(path.join(root, "apps/api/.env.local"), "API_SECRET=1\n");
    writeFileSync(path.join(worktree, "apps/api/.env.local"), "EXISTING=1\n");

    const isIgnored = vi.fn(
      async (_projectPath: string, rel: string) =>
        rel === ".env" || rel === "apps/api/.env.local",
    );

    const results = await copyWorktreeLocalFiles(
      root,
      worktree,
      [".env", "apps/api/.env.local"],
      { isIgnored },
    );

    expect(results).toEqual([
      { path: ".env", size: 9, status: "copied" },
      {
        path: "apps/api/.env.local",
        size: 13,
        status: "skipped",
        reason: "destination exists",
      },
    ]);
    expect(readFileSync(path.join(worktree, ".env"), "utf-8")).toBe(
      "SECRET=1\n",
    );
    expect(
      readFileSync(path.join(worktree, "apps/api/.env.local"), "utf-8"),
    ).toBe("EXISTING=1\n");
  });

  it("reports invalid, non-ignored, missing, symlink, and oversized paths as skipped", async () => {
    const root = tempDir();
    const worktree = tempDir();
    writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    writeFileSync(path.join(root, "tracked.local"), "tracked\n");
    writeFileSync(path.join(root, "large.local"), "x".repeat(300 * 1024));
    symlinkSync(path.join(root, ".env"), path.join(root, "linked.local"));

    const isIgnored = vi.fn(
      async (_projectPath: string, rel: string) => rel !== "tracked.local",
    );

    const results = await copyWorktreeLocalFiles(
      root,
      worktree,
      [
        "../secret",
        "/abs/.env",
        "tracked.local",
        "missing.local",
        "linked.local",
        "large.local",
      ],
      { isIgnored },
    );

    expect(results).toEqual([
      { path: "../secret", status: "skipped", reason: "invalid path" },
      { path: "/abs/.env", status: "skipped", reason: "invalid path" },
      {
        path: "tracked.local",
        status: "skipped",
        reason: "not an ignored regular file",
      },
      {
        path: "missing.local",
        status: "skipped",
        reason: "not an ignored regular file",
      },
      {
        path: "linked.local",
        status: "skipped",
        reason: "not an ignored regular file",
      },
      {
        path: "large.local",
        status: "skipped",
        reason: "not an ignored regular file",
      },
    ]);
    expect(existsSync(path.join(worktree, "tracked.local"))).toBe(false);
    expect(existsSync(path.join(worktree, "linked.local"))).toBe(false);
    expect(existsSync(path.join(worktree, "large.local"))).toBe(false);
  });

  it("keeps going when one copy operation fails", async () => {
    const root = tempDir();
    const worktree = tempDir();
    writeFileSync(path.join(root, ".env"), "SECRET=1\n");
    writeFileSync(path.join(root, ".env.local"), "LOCAL=1\n");
    const copyFile = vi.fn(
      async (from: PathLike, to: PathLike, flags?: number) => {
        const fromPath = String(from);
        const toPath = String(to);
        if (fromPath.endsWith(".env")) throw new Error("copy denied");
        copyFileSync(fromPath, toPath, flags);
      },
    );

    const results = await copyWorktreeLocalFiles(
      root,
      worktree,
      [".env", ".env.local"],
      {
        isIgnored: async () => true,
        copyFile,
      },
    );

    expect(results).toEqual([
      {
        path: ".env",
        size: 9,
        status: "failed",
        reason: "copy denied",
      },
      { path: ".env.local", size: 8, status: "copied" },
    ]);
  });
});
