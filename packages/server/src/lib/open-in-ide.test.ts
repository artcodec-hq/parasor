import { describe, expect, it, vi } from "vitest";
import {
  isSupportedIdeEditor,
  OpenInIdeError,
  openInIde,
} from "./open-in-ide.js";

describe("openInIde", () => {
  it("uses macOS app launch for Cursor", async () => {
    const run = vi.fn(async () => undefined);
    await openInIde("/tmp/wt", "cursor", { platform: "darwin", run });
    expect(run).toHaveBeenCalledWith("open", ["-a", "Cursor", "/tmp/wt"]);
  });

  it("uses macOS app launch for VS Code", async () => {
    const run = vi.fn(async () => undefined);
    await openInIde("/tmp/wt", "vscode", { platform: "darwin", run });
    expect(run).toHaveBeenCalledWith("open", [
      "-a",
      "Visual Studio Code",
      "/tmp/wt",
    ]);
  });

  it("uses CLI launch on Linux", async () => {
    const run = vi.fn(async () => undefined);
    await openInIde("/tmp/wt", "vscode", { platform: "linux", run });
    expect(run).toHaveBeenCalledWith("code", ["/tmp/wt"]);
  });

  it("uses cmd launchers on Windows", async () => {
    const run = vi.fn(async () => undefined);
    await openInIde("C:\\wt", "cursor", { platform: "win32", run });
    expect(run).toHaveBeenCalledWith("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Start-Process -FilePath $args[0] -ArgumentList @($args[1])",
      "cursor.cmd",
      "C:\\wt",
    ]);
  });

  it("uses custom IDE command argv with path substitution", async () => {
    const run = vi.fn(async () => undefined);
    await openInIde("/tmp/wt", "zed", {
      customCommands: [
        { id: "zed", label: "Zed", command: "zed", args: ["--add", "{path}"] },
      ],
      platform: "darwin",
      run,
    });
    expect(run).toHaveBeenCalledWith("zed", ["--add", "/tmp/wt"]);
  });

  it("appends the worktree path when a custom IDE command omits the placeholder", async () => {
    const run = vi.fn(async () => undefined);
    await openInIde("/tmp/wt", "idea", {
      customCommands: [
        {
          id: "idea",
          label: "IntelliJ",
          command: "idea",
          args: ["--line", "1"],
        },
      ],
      platform: "linux",
      run,
    });
    expect(run).toHaveBeenCalledWith("idea", ["--line", "1", "/tmp/wt"]);
  });

  it("rejects unsupported platforms", async () => {
    const run = vi.fn();
    await expect(
      openInIde("/tmp/wt", "cursor", {
        platform: "freebsd" as NodeJS.Platform,
        run,
      }),
    ).rejects.toBeInstanceOf(OpenInIdeError);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects unsupported editor ids", async () => {
    await expect(openInIde("/tmp/wt", "vim")).rejects.toBeInstanceOf(
      OpenInIdeError,
    );
  });

  it("validates supported editor ids", () => {
    expect(isSupportedIdeEditor("cursor")).toBe(true);
    expect(isSupportedIdeEditor("vscode")).toBe(true);
    expect(isSupportedIdeEditor("vim")).toBe(false);
    expect(isSupportedIdeEditor(null)).toBe(false);
  });
});
