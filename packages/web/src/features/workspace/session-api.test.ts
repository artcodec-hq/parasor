import type { Session } from "@parasor/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authFetch } from "../../lib/auth-fetch.js";
import {
  createSession,
  deleteSession,
  renameSession,
  restartSession,
  setSessionPin,
} from "./session-api.js";

vi.mock("../../lib/auth-fetch.js", () => ({
  authFetch: vi.fn(),
}));

const authFetchMock = vi.mocked(authFetch);

const sampleSession = { id: "s1", projectId: "p1" } as unknown as Session;

describe("session-api", () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true })));
  });

  describe("createSession", () => {
    it("posts only the projectId when no optional fields are provided", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSession)),
      );

      await expect(createSession({ projectId: "p1" })).resolves.toEqual(
        sampleSession,
      );

      expect(authFetchMock).toHaveBeenCalledWith("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "p1" }),
      });
    });

    it("includes only the provided optional fields in the body", async () => {
      authFetchMock.mockResolvedValueOnce(
        new Response(JSON.stringify(sampleSession)),
      );

      await createSession({
        projectId: "p1",
        command: { type: "claude" } as const,
        title: "T",
        cwd: "/repo",
        launchPreset: {
          presetId: "builtin:codex",
          source: "builtin",
          label: "Codex",
          commandLine: "codex",
        },
        bootstrapInput: "hi\r",
      });

      expect(authFetchMock).toHaveBeenCalledWith("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "p1",
          command: { type: "claude" } as const,
          title: "T",
          cwd: "/repo",
          launchPreset: {
            presetId: "builtin:codex",
            source: "builtin",
            label: "Codex",
            commandLine: "codex",
          },
          bootstrapInput: "hi\r",
        }),
      });
    });

    it("returns null on a non-ok response", async () => {
      authFetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

      await expect(createSession({ projectId: "p1" })).resolves.toBeNull();
    });
  });

  describe("restartSession", () => {
    it("posts to the restart endpoint", async () => {
      await restartSession("s1");

      expect(authFetchMock).toHaveBeenCalledWith("/api/sessions/s1/restart", {
        method: "POST",
      });
    });
  });

  describe("renameSession", () => {
    it("posts the title to the title endpoint", async () => {
      await renameSession("s1", "New Title");

      expect(authFetchMock).toHaveBeenCalledWith("/api/sessions/s1/title", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Title" }),
      });
    });
  });

  describe("setSessionPin", () => {
    it("posts the pinned flag to the pin endpoint", async () => {
      await setSessionPin("s1", true);

      expect(authFetchMock).toHaveBeenCalledWith("/api/sessions/s1/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: true }),
      });
    });

    it("posts pinned: false when unpinning", async () => {
      await setSessionPin("s1", false);

      expect(authFetchMock).toHaveBeenCalledWith("/api/sessions/s1/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: false }),
      });
    });
  });

  describe("deleteSession", () => {
    it("deletes the session", async () => {
      await deleteSession("s1");

      expect(authFetchMock).toHaveBeenCalledWith("/api/sessions/s1", {
        method: "DELETE",
      });
    });
  });
});
