import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectManager } from "../state/project-manager.js";
import { WorktreeCache } from "../state/worktree-cache.js";
import type { EventBus } from "../ws/events.js";
import { createProjectPresence } from "./project-presence.js";
import { createProjectRuntime } from "./project-runtime.js";

describe("createProjectRuntime missing paths", () => {
  const dirs: string[] = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    unhandled.push(reason);
  };

  afterEach(async () => {
    process.removeListener("unhandledRejection", onUnhandled);
    unhandled.length = 0;
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
  });

  it("noteLiveSession on a missing project does not unhandled-reject", async () => {
    process.on("unhandledRejection", onUnhandled);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const present = mkdtempSync(join(tmpdir(), "parasor-rt-ok-"));
    dirs.push(present);
    const missing = join(tmpdir(), `parasor-rt-missing-${Date.now()}`);
    const projects = {
      ok: {
        id: "ok",
        path: present,
        name: "ok",
        createdAt: 1,
        lastAccessedAt: 1,
      },
      gone: {
        id: "gone",
        path: missing,
        name: "gone",
        createdAt: 1,
        lastAccessedAt: 1,
      },
    };
    const projectManager = {
      get: (id: string) => projects[id as keyof typeof projects],
      list: () => Object.values(projects),
    } as unknown as ProjectManager;
    const presence = createProjectPresence();
    presence.probeSync(projects.gone);
    const runtime = createProjectRuntime({
      projectManager,
      eventBus: { broadcast: vi.fn() } as unknown as EventBus,
      worktreeCache: new WorktreeCache(),
      presence,
    });
    expect(() => runtime.noteLiveSession("gone")).not.toThrow();
    expect(() => runtime.noteLiveSession("ok")).not.toThrow();
    expect(runtime.isLiveWatched("gone")).toBe(false);
    await new Promise((r) => setTimeout(r, 50));
    await runtime.dispose();
    expect(unhandled).toEqual([]);
    warn.mockRestore();
  });
});
