import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createProjectPresence } from "./project-presence.js";

describe("createProjectPresence", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0))
      rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("marks missing on boot probe without writing state", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const presence = createProjectPresence();
    const path = join(tmpdir(), `parasor-presence-missing-${Date.now()}`);
    const changed = presence.probeSync({ id: "kimi", path });
    expect(changed).toBe(true);
    expect(presence.isMissing("kimi")).toBe(true);
    expect(presence.missingIds()).toEqual(["kimi"]);
    expect(warn).toHaveBeenCalledWith(
      `[project-presence] missing project=kimi path=${path}`,
    );
    expect(warn.mock.calls[0]?.[0]).not.toBeInstanceOf(Error);
  });

  it("notifies onChange only after a mark flips", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const changes: Array<[string, boolean]> = [];
    const presence = createProjectPresence();
    presence.setOnChange((id, missing) => changes.push([id, missing]));
    const path = join(tmpdir(), `parasor-presence-change-${Date.now()}`);
    expect(presence.markMissing("kimi", path, "test")).toBe(true);
    expect(presence.markMissing("kimi", path, "test")).toBe(false);
    expect(presence.markPresent("kimi", path)).toBe(true);
    expect(changes).toEqual([
      ["kimi", true],
      ["kimi", false],
    ]);
    warn.mockRestore();
  });

  it("does not mark present projects missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "parasor-presence-ok-"));
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    const presence = createProjectPresence();
    expect(presence.probeSync({ id: "ok", path: dir })).toBe(false);
    expect(presence.isMissing("ok")).toBe(false);
  });
});
