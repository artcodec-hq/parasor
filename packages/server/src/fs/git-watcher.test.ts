import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GitWatcher,
  parseGitPorcelain,
  parseGitStatusV2,
  parseGitStatusV2WithFiles,
} from "./git-watcher.js";

const GIT_IDENTITY_ENV = {
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_AUTHOR_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
};

describe("GitWatcher", () => {
  let root: string;
  let watcher: GitWatcher;

  beforeEach(() => {
    Object.assign(process.env, GIT_IDENTITY_ENV);
    root = join(tmpdir(), `parasor-git-test-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    watcher = new GitWatcher();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("flags non-git directory with isRepo=false", async () => {
    const state = await watcher.check(root);
    // Non-git path now resolves to a defined state with isRepo=false so the
    // Git pane can render the init empty-state instead of treating it as a
    // transient failure.
    expect(state).not.toBeNull();
    expect(state?.isRepo).toBe(false);
    expect(state?.branch).toBe("");
    expect(state?.dirty).toBe(false);
  });

  it("returns branch and dirty state for git repo", async () => {
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["checkout", "-b", "main"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], {
      cwd: root,
    });

    const state = await watcher.check(root);
    expect(state).not.toBeNull();
    expect(state?.branch).toBe("main");
    expect(state?.dirty).toBe(false);
  });

  it("detects dirty state", async () => {
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["checkout", "-b", "main"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], {
      cwd: root,
    });
    writeFileSync(join(root, "file.txt"), "modified");

    const state = await watcher.check(root);
    expect(state?.dirty).toBe(true);
  });

  it("detects branch after switch", async () => {
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["checkout", "-b", "main"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], {
      cwd: root,
    });
    execFileSync("git", ["checkout", "-b", "feature/test"], { cwd: root });

    const state = await watcher.check(root);
    expect(state?.branch).toBe("feature/test");
  });

  it("returns fileStatuses for dirty repo", async () => {
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["checkout", "-b", "main"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], {
      cwd: root,
    });
    writeFileSync(join(root, "file.txt"), "modified");
    writeFileSync(join(root, "new.txt"), "new");

    const state = await watcher.check(root);
    expect(state?.fileStatuses).toBeDefined();
    expect(state?.fileStatuses?.["file.txt"]).toBe("M");
    expect(state?.fileStatuses?.["new.txt"]).toBe("?");
    expect(state?.changes).toEqual([
      {
        path: "file.txt",
        area: "unstaged",
        status: "modified",
        code: "M",
        worktreeStatus: "M",
      },
      {
        path: "new.txt",
        area: "untracked",
        status: "untracked",
        code: "?",
      },
    ]);
  });

  it("returns no fileStatuses for clean repo", async () => {
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["checkout", "-b", "main"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], {
      cwd: root,
    });

    const state = await watcher.check(root);
    expect(state?.fileStatuses).toBeUndefined();
    expect(state?.changes).toBeUndefined();
  });
});

describe("GitWatcher.checkAndDiff", () => {
  let root: string;
  let watcher: GitWatcher;

  beforeEach(() => {
    root = join(tmpdir(), `parasor-git-diff-${Date.now()}`);
    mkdirSync(root, { recursive: true });
    execFileSync("git", ["init"], { cwd: root });
    execFileSync("git", ["checkout", "-b", "main"], { cwd: root });
    writeFileSync(join(root, "file.txt"), "hello");
    execFileSync("git", ["add", "."], { cwd: root });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], {
      cwd: root,
    });
    watcher = new GitWatcher();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns changed=true on first call", async () => {
    const { state, changed } = await watcher.checkAndDiff("proj1", root);
    expect(changed).toBe(true);
    expect(state).not.toBeNull();
    expect(state?.branch).toBe("main");
  });

  it("returns changed=false when state unchanged", async () => {
    await watcher.checkAndDiff("proj1", root);
    const { changed } = await watcher.checkAndDiff("proj1", root);
    expect(changed).toBe(false);
  });

  it("returns changed=true when dirty state changes", async () => {
    await watcher.checkAndDiff("proj1", root);
    writeFileSync(join(root, "file.txt"), "modified");
    const { state, changed } = await watcher.checkAndDiff("proj1", root);
    expect(changed).toBe(true);
    expect(state?.dirty).toBe(true);
  });

  it("returns changed=true when branch changes", async () => {
    await watcher.checkAndDiff("proj1", root);
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: root });
    const { state, changed } = await watcher.checkAndDiff("proj1", root);
    expect(changed).toBe(true);
    expect(state?.branch).toBe("feature");
  });

  it("returns changed=true when file statuses change", async () => {
    writeFileSync(join(root, "file.txt"), "modified");
    await watcher.checkAndDiff("proj1", root);
    writeFileSync(join(root, "another.txt"), "new");
    const { changed } = await watcher.checkAndDiff("proj1", root);
    expect(changed).toBe(true);
  });

  it("caches state per projectId independently", async () => {
    const root2 = join(tmpdir(), `parasor-git-diff2-${Date.now()}`);
    mkdirSync(root2, { recursive: true });
    execFileSync("git", ["init"], { cwd: root2 });
    execFileSync("git", ["checkout", "-b", "dev"], { cwd: root2 });
    writeFileSync(join(root2, "f.txt"), "x");
    execFileSync("git", ["add", "."], { cwd: root2 });
    execFileSync("git", ["commit", "-m", "init", "--no-gpg-sign"], {
      cwd: root2,
    });

    await watcher.checkAndDiff("proj1", root);
    const { state, changed } = await watcher.checkAndDiff("proj2", root2);
    expect(changed).toBe(true);
    expect(state?.branch).toBe("dev");

    rmSync(root2, { recursive: true, force: true });
  });

  it("clearProject causes next checkAndDiff to report changed", async () => {
    await watcher.checkAndDiff("proj1", root);
    watcher.clearProject("proj1");
    const { changed } = await watcher.checkAndDiff("proj1", root);
    expect(changed).toBe(true);
  });

  it("caches independently per worktree under the same project", async () => {
    const wt = join(tmpdir(), `parasor-git-wt-${Date.now()}`);
    execFileSync("git", ["worktree", "add", wt, "-b", "side"], { cwd: root });

    await watcher.checkAndDiff("proj1", root);
    const { state, changed } = await watcher.checkAndDiff("proj1", wt);
    expect(changed).toBe(true);
    expect(state?.branch).toBe("side");

    expect(watcher.getCached("proj1", root)?.branch).toBe("main");
    expect(watcher.getCached("proj1", wt)?.branch).toBe("side");

    watcher.clearWorktree("proj1", wt);
    expect(watcher.getCached("proj1", wt)).toBeNull();
    expect(watcher.getCached("proj1", root)?.branch).toBe("main");

    execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
  });

  it("getAllCached groups entries by projectId", async () => {
    const wt = join(tmpdir(), `parasor-git-wt2-${Date.now()}`);
    execFileSync("git", ["worktree", "add", wt, "-b", "feat"], { cwd: root });

    await watcher.checkAndDiff("proj1", root);
    await watcher.checkAndDiff("proj1", wt);

    const grouped = watcher.getAllCached();
    expect(grouped.proj1).toBeDefined();
    expect(Object.keys(grouped.proj1)).toHaveLength(2);
    expect(grouped.proj1[root]?.branch).toBe("main");
    expect(grouped.proj1[wt]?.branch).toBe("feat");

    execFileSync("git", ["worktree", "remove", "--force", wt], { cwd: root });
  });
});

describe("parseGitPorcelain", () => {
  it("parses modified file", () => {
    expect(parseGitPorcelain(" M src/app.ts")).toEqual({ "src/app.ts": "M" });
  });

  it("parses staged file", () => {
    expect(parseGitPorcelain("M  src/app.ts")).toEqual({ "src/app.ts": "M" });
  });

  it("parses untracked file", () => {
    expect(parseGitPorcelain("?? new-file.ts")).toEqual({ "new-file.ts": "?" });
  });

  it("parses deleted file", () => {
    expect(parseGitPorcelain(" D old.ts")).toEqual({ "old.ts": "D" });
  });

  it("parses renamed file", () => {
    expect(parseGitPorcelain("R  old.ts -> new.ts")).toEqual({ "new.ts": "R" });
  });

  it("parses added file", () => {
    expect(parseGitPorcelain("A  brand-new.ts")).toEqual({
      "brand-new.ts": "A",
    });
  });

  it("prefers worktree status over index", () => {
    // MM = modified in both index and worktree
    expect(parseGitPorcelain("MM src/app.ts")).toEqual({ "src/app.ts": "M" });
  });

  it("parses multiple files", () => {
    const input = [
      " M src/a.ts",
      "?? src/b.ts",
      " D src/c.ts",
      "A  src/d.ts",
    ].join("\n");
    expect(parseGitPorcelain(input)).toEqual({
      "src/a.ts": "M",
      "src/b.ts": "?",
      "src/c.ts": "D",
      "src/d.ts": "A",
    });
  });

  it("returns empty for empty input", () => {
    expect(parseGitPorcelain("")).toEqual({});
  });

  it("does not treat arrow in non-rename as rename", () => {
    // File literally named "a -> b.txt" modified (not a rename)
    expect(parseGitPorcelain(" M a -> b.txt")).toEqual({ "a -> b.txt": "M" });
  });

  it("unquotes C-style quoted path with spaces", () => {
    expect(parseGitPorcelain(' M "src/my file.ts"')).toEqual({
      "src/my file.ts": "M",
    });
  });

  it("unquotes C-style quoted path with tab escape", () => {
    expect(parseGitPorcelain(' M "src/a\\tb.ts"')).toEqual({
      "src/a\tb.ts": "M",
    });
  });

  it("unquotes C-style quoted path with backslash escape", () => {
    expect(parseGitPorcelain(' M "src/a\\\\b.ts"')).toEqual({
      "src/a\\b.ts": "M",
    });
  });

  it("unquotes C-style quoted path with octal bytes (UTF-8)", () => {
    // é = \xc3\xa9 = octal \303\251
    expect(parseGitPorcelain(' M "\\303\\251.ts"')).toEqual({ "é.ts": "M" });
  });

  it("unquotes C-style quoted path with double-quote escape", () => {
    expect(parseGitPorcelain(' M "a\\"b.ts"')).toEqual({ 'a"b.ts': "M" });
  });

  it("unquotes renamed file with quoted paths", () => {
    expect(parseGitPorcelain('R  "old name.ts" -> "new name.ts"')).toEqual({
      "new name.ts": "R",
    });
  });

  it("handles untracked file with quoted path", () => {
    expect(parseGitPorcelain('?? "dir with spaces/file.ts"')).toEqual({
      "dir with spaces/file.ts": "?",
    });
  });
});

describe("parseGitStatusV2", () => {
  it("parses ahead/behind from branch.ab header", () => {
    const input = ["# branch.ab +3 -2", ""].join("\n");
    expect(parseGitStatusV2(input)).toEqual({
      ahead: 3,
      behind: 2,
      dirtyCount: 0,
    });
  });

  it("returns undefined ahead/behind when no upstream tracking", () => {
    const input = ["# branch.oid abc", "# branch.head main", ""].join("\n");
    expect(parseGitStatusV2(input)).toEqual({
      ahead: undefined,
      behind: undefined,
      dirtyCount: 0,
    });
  });

  it("counts ordinary tracked changes (1 prefix)", () => {
    const input = [
      "# branch.ab +0 -0",
      "1 .M N... 100644 100644 100644 abc def src/a.ts",
      "1 M. N... 100644 100644 100644 abc def src/b.ts",
      "",
    ].join("\n");
    expect(parseGitStatusV2(input).dirtyCount).toBe(2);
  });

  it("counts rename entries (2 prefix) once each", () => {
    const input = [
      "# branch.ab +0 -0",
      "2 R. N... 100644 100644 100644 abc def R100 new.ts\told.ts",
      "",
    ].join("\n");
    expect(parseGitStatusV2(input).dirtyCount).toBe(1);
  });

  it("counts unmerged entries (u prefix)", () => {
    const input = [
      "u UU N... 100644 100644 100644 100644 abc def 123 conflict.ts",
      "",
    ].join("\n");
    expect(parseGitStatusV2(input).dirtyCount).toBe(1);
  });

  it("counts untracked entries (? prefix)", () => {
    const input = ["? new.ts", "? other.ts", ""].join("\n");
    expect(parseGitStatusV2(input).dirtyCount).toBe(2);
  });

  it("excludes ignored entries (! prefix) from dirtyCount", () => {
    const input = ["? real.ts", "! .DS_Store", "! build/output"].join("\n");
    expect(parseGitStatusV2(input).dirtyCount).toBe(1);
  });

  it("returns zero counters for clean tracked branch", () => {
    const input = [
      "# branch.oid abc",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +0 -0",
      "",
    ].join("\n");
    expect(parseGitStatusV2(input)).toEqual({
      ahead: 0,
      behind: 0,
      dirtyCount: 0,
    });
  });

  it("returns dirtyCount=0 for empty input", () => {
    expect(parseGitStatusV2("")).toEqual({
      ahead: undefined,
      behind: undefined,
      dirtyCount: 0,
    });
  });
});

describe("parseGitStatusV2WithFiles", () => {
  it("returns structured changes while preserving compact fileStatuses", () => {
    const input = [
      "# branch.head main",
      "# branch.ab +1 -2",
      "1 .M N... 100644 100644 100644 abc def src/unstaged.ts",
      "1 M. N... 100644 100644 100644 abc def src/staged.ts",
      "? src/new.ts",
      "",
    ].join("\0");

    expect(parseGitStatusV2WithFiles(input)).toEqual({
      branch: "main",
      ahead: 1,
      behind: 2,
      dirtyCount: 3,
      fileStatuses: {
        "src/unstaged.ts": "M",
        "src/staged.ts": "M",
        "src/new.ts": "?",
      },
      changes: [
        {
          path: "src/unstaged.ts",
          area: "unstaged",
          status: "modified",
          code: "M",
          worktreeStatus: "M",
        },
        {
          path: "src/staged.ts",
          area: "staged",
          status: "modified",
          code: "M",
          indexStatus: "M",
        },
        {
          path: "src/new.ts",
          area: "untracked",
          status: "untracked",
          code: "?",
        },
      ],
    });
  });

  it("keeps oldPath for renames", () => {
    const input = [
      "2 R. N... 100644 100644 100644 abc def R100 src/new.ts",
      "src/old.ts",
      "",
    ].join("\0");

    expect(parseGitStatusV2WithFiles(input).changes).toEqual([
      {
        path: "src/new.ts",
        area: "staged",
        status: "renamed",
        code: "R",
        oldPath: "src/old.ts",
        indexStatus: "R",
      },
    ]);
  });

  it("marks unmerged entries as conflicts", () => {
    const input = [
      "u UU N... 100644 100644 100644 100644 abc def 123 src/conflict.ts",
      "",
    ].join("\0");

    expect(parseGitStatusV2WithFiles(input).changes).toEqual([
      {
        path: "src/conflict.ts",
        area: "unstaged",
        status: "conflict",
        code: "U",
        conflict: true,
        indexStatus: "U",
        worktreeStatus: "U",
      },
    ]);
  });
});
