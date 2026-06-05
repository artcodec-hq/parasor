import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { postHookNotifyMock } = vi.hoisted(() => ({
  postHookNotifyMock: vi.fn<
    (args: {
      sessionId: string;
      agent: string;
      event: string;
    }) => Promise<{ ok: boolean; error?: string }>
  >(async () => ({ ok: true })),
}));

vi.mock("./hook-client.js", () => ({
  postHookNotify: postHookNotifyMock,
}));

import { cliNotify } from "./notify.js";

interface ProcessExitError extends Error {
  exitCode: number;
}

function patchExit(): () => void {
  const original = process.exit;
  process.exit = ((code?: number) => {
    const err: ProcessExitError = Object.assign(
      new Error(`process.exit(${code ?? 0})`),
      { exitCode: code ?? 0 },
    );
    throw err;
  }) as never;
  return () => {
    process.exit = original;
  };
}

async function runNotify(args: string[]): Promise<number> {
  const restoreExit = patchExit();
  let exitCode = 0;
  try {
    await cliNotify(args);
  } catch (err) {
    if ((err as ProcessExitError).exitCode !== undefined) {
      exitCode = (err as ProcessExitError).exitCode;
    } else {
      throw err;
    }
  } finally {
    restoreExit();
  }
  return exitCode;
}

describe("cliNotify", () => {
  let originalSession: string | undefined;

  beforeEach(() => {
    postHookNotifyMock.mockClear();
    postHookNotifyMock.mockResolvedValue({ ok: true });
    originalSession = process.env.PARASOR_SESSION_ID;
    process.env.PARASOR_SESSION_ID = "env-session";
  });

  afterEach(() => {
    if (originalSession === undefined) delete process.env.PARASOR_SESSION_ID;
    else process.env.PARASOR_SESSION_ID = originalSession;
  });

  it("posts running with sessionId from PARASOR_SESSION_ID", async () => {
    const code = await runNotify(["running"]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "env-session",
      agent: "manual",
      event: "running",
    });
  });

  it("--session flag overrides the env var", async () => {
    const code = await runNotify(["waiting", "--session", "flag-session"]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "flag-session",
      agent: "manual",
      event: "waiting",
    });
  });

  it("--session=value form is also accepted", async () => {
    const code = await runNotify(["idle", "--session=eq-session"]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "eq-session",
      agent: "manual",
      event: "idle",
    });
  });

  it("accepts completed as a manual notify state", async () => {
    const code = await runNotify(["completed"]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).toHaveBeenCalledWith({
      sessionId: "env-session",
      agent: "manual",
      event: "completed",
    });
  });

  it("exits 1 when no state argument is given", async () => {
    const code = await runNotify([]);
    expect(code).toBe(1);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("exits 1 when state is not in the manual enum", async () => {
    const code = await runNotify(["review"]);
    expect(code).toBe(1);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("exits 1 when no session id can be resolved", async () => {
    delete process.env.PARASOR_SESSION_ID;
    const code = await runNotify(["running"]);
    expect(code).toBe(1);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });

  it("exits 1 when the HTTP post fails", async () => {
    postHookNotifyMock.mockResolvedValueOnce({ ok: false, error: "boom" });
    const code = await runNotify(["running"]);
    expect(code).toBe(1);
  });

  it("exits 0 on --help", async () => {
    const code = await runNotify(["--help"]);
    expect(code).toBe(0);
    expect(postHookNotifyMock).not.toHaveBeenCalled();
  });
});
