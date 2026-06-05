import type { IdeCommandConfig } from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "../../lib/auth-fetch.js";
import type { CustomPaneCommand } from "../../lib/pane-command-store.js";
import { saveIdeCommands, savePaneCommands } from "./command-api.js";

vi.mock("../../lib/auth-fetch.js", () => ({
  authFetch: vi.fn(),
}));

const authFetchMock = vi.mocked(authFetch);

describe("command-api", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });

  describe("savePaneCommands", () => {
    it("puts the commands and returns the parsed body", async () => {
      const commands = [
        { id: "c1", label: "L", initialInput: "" },
      ] as unknown as CustomPaneCommand[];
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ commands })),
      );

      await expect(savePaneCommands(commands)).resolves.toEqual({ commands });

      expect(authFetchMock).toHaveBeenCalledWith("/api/pane-commands", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });
    });

    it("throws on a non-ok response", async () => {
      authFetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

      await expect(savePaneCommands([])).rejects.toThrow(
        "Failed to save commands",
      );
    });
  });

  describe("saveIdeCommands", () => {
    it("puts the commands and returns the parsed body", async () => {
      const commands = [
        { id: "zed", label: "Zed", command: "zed", args: ["{path}"] },
      ] as IdeCommandConfig[];
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify({ commands })),
      );

      await expect(saveIdeCommands(commands)).resolves.toEqual({ commands });

      expect(authFetchMock).toHaveBeenCalledWith("/api/ide-commands", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commands }),
      });
    });

    it("throws on a non-ok response", async () => {
      authFetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

      await expect(saveIdeCommands([])).rejects.toThrow(
        "Failed to save IDE commands",
      );
    });
  });
});
