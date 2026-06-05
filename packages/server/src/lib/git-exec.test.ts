import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GitExecError,
  resolveWorktreePath,
  runGit,
  WorktreeNotRegisteredError,
} from "./git-exec.js";

function initRepo(path: string) {
  execFileSync("git", ["init", "-q"], { cwd: path });
  execFileSync("git", ["checkout", "-q", "-b", "main"], { cwd: path });
  execFileSync("git", ["config", "user.email", "test@example.com"], {
    cwd: path,
  });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: path });
  execFileSync(
    "git",
    ["commit", "--allow-empty", "-m", "init", "--no-gpg-sign"],
    {
      cwd: path,
    },
  );
}

describe("git-exec.runGit", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "parasor-git-exec-"));
    initRepo(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns stdout for a successful git command", async () => {
    const { stdout } = await runGit(root, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ]);
    expect(stdout.trim()).toBe("main");
  });

  it("throws GitExecError carrying stderr on failure", async () => {
    await expect(
      runGit(root, ["nonexistent-subcommand"]),
    ).rejects.toBeInstanceOf(GitExecError);
    try {
      await runGit(root, ["nonexistent-subcommand"]);
    } catch (err) {
      const e = err as GitExecError;
      expect(e.stderr.length).toBeGreaterThan(0);
      expect(e.exitCode).not.toBeNull();
    }
  });
});

describe("git-exec.resolveWorktreePath", () => {
  let root: string;
  let project: string;
  let worktree: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "parasor-git-resolve-"));
    project = join(root, "project");
    execFileSync("mkdir", ["-p", project]);
    initRepo(project);
    worktree = join(root, "project.worktrees", "feature");
    execFileSync("git", ["worktree", "add", "-q", "-b", "feature", worktree], {
      cwd: project,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns canonical path for the main worktree", async () => {
    const resolved = await resolveWorktreePath(project, project, []);
    expect(resolved.endsWith("/project")).toBe(true);
  });

  it("returns canonical path for a registered linked worktree", async () => {
    const resolved = await resolveWorktreePath(project, worktree, [
      { path: worktree, head: "", branch: "feature" },
    ]);
    expect(resolved).toContain("project.worktrees");
  });

  it("rejects an unregistered path", async () => {
    const stray = mkdtempSync(join(tmpdir(), "parasor-git-stray-"));
    await expect(
      resolveWorktreePath(project, stray, []),
    ).rejects.toBeInstanceOf(WorktreeNotRegisteredError);
    rmSync(stray, { recursive: true, force: true });
  });

  it("rejects a nonexistent path", async () => {
    await expect(
      resolveWorktreePath(project, join(root, "does-not-exist"), []),
    ).rejects.toBeInstanceOf(WorktreeNotRegisteredError);
  });

  it("matches symlinked aliases via realpath", async () => {
    const alias = join(root, "alias");
    symlinkSync(project, alias);
    const resolved = await resolveWorktreePath(project, alias, []);
    expect(resolved.endsWith("/project")).toBe(true);
  });
});
