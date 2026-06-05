import { describe, expect, it, vi } from "vitest";
import { OpenInOsError, openInOs } from "./open-in-os.js";

describe("openInOs", () => {
  it("uses `open` on macOS", async () => {
    const run = vi.fn(async () => undefined);
    await openInOs("/tmp/wt", { platform: "darwin", run });
    expect(run).toHaveBeenCalledWith("open", ["/tmp/wt"]);
  });

  it("uses `xdg-open` on Linux", async () => {
    const run = vi.fn(async () => undefined);
    await openInOs("/tmp/wt", { platform: "linux", run });
    expect(run).toHaveBeenCalledWith("xdg-open", ["/tmp/wt"]);
  });

  it("uses `explorer` on Windows", async () => {
    const run = vi.fn(async () => undefined);
    await openInOs("C:\\wt", { platform: "win32", run });
    expect(run).toHaveBeenCalledWith("explorer", ["C:\\wt"]);
  });

  it("treats explorer exit code 1 as success", async () => {
    const run = vi.fn(async () => {
      const err = new Error("explorer exited with 1") as Error & {
        code?: number;
      };
      err.code = 1;
      throw err;
    });
    await expect(
      openInOs("C:\\wt", { platform: "win32", run }),
    ).resolves.toBeUndefined();
  });

  it("rethrows explorer non-1 failures as OpenInOsError", async () => {
    const run = vi.fn(async () => {
      const err = new Error("explorer not found") as Error & { code?: number };
      err.code = 127;
      throw err;
    });
    await expect(
      openInOs("C:\\wt", { platform: "win32", run }),
    ).rejects.toBeInstanceOf(OpenInOsError);
  });

  it("rejects unsupported platforms", async () => {
    const run = vi.fn();
    await expect(
      openInOs("/tmp/wt", { platform: "freebsd" as NodeJS.Platform, run }),
    ).rejects.toBeInstanceOf(OpenInOsError);
    expect(run).not.toHaveBeenCalled();
  });
});
