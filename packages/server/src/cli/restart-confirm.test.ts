import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ProbeResult } from "./probe-daemon-version.js";
import {
  confirmRestartIfMismatch,
  extractAutoYesFlag,
  readLineFromInput,
} from "./restart-confirm.js";

/*
 * Restart confirmation -- these tests cover the gate-decision matrix:
 *   probe outcome  × autoYes  × isTty  ->  {proceed, reason}
 *
 * Real socket IO and stdin are stubbed via the deps interface so each
 * branch can be exercised deterministically. The probe-side logic is
 * tested separately in probe-daemon-version.test.ts.
 */

interface HarnessOptions {
  probeResult: ProbeResult;
  isTty?: boolean;
  readLineAnswer?: string | null;
}

function makeHarness(opts: HarnessOptions) {
  const logs: string[] = [];
  const probe = vi.fn(async () => opts.probeResult);
  const readLine = vi.fn(async () => opts.readLineAnswer ?? null);
  const deps = {
    isTty: opts.isTty ?? true,
    log: (m: string) => logs.push(m),
    readLine,
    probe,
    resolvePaths: () => ({ socketPath: "/ignored" }),
  };
  return { deps, logs, probe, readLine };
}

describe("confirmRestartIfMismatch", () => {
  it("proceeds without prompting when no daemon is running", async () => {
    const { deps, logs, readLine } = makeHarness({
      probeResult: { status: "no-daemon" },
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(true);
    expect(result.reason).toMatch(/no daemon/);
    expect(readLine).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it("proceeds without prompting when daemon is compatible", async () => {
    const { deps, logs, readLine } = makeHarness({
      probeResult: {
        status: "compatible",
        daemonVersion: "1.2.0",
        serverVersion: "1.2.0",
      },
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(true);
    expect(result.reason).toMatch(/compatible/);
    expect(readLine).not.toHaveBeenCalled();
    expect(logs).toHaveLength(0);
  });

  it("proceeds with a warning log when probe outcome is unknown", async () => {
    const { deps, logs, readLine } = makeHarness({
      probeResult: { status: "unknown", reason: "timed out after 2000ms" },
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(true);
    expect(result.reason).toMatch(/probe unknown/);
    expect(readLine).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("inconclusive"))).toBe(true);
    expect(logs.some((l) => l.includes("timed out"))).toBe(true);
  });

  it("proceeds on mismatch when --yes is passed (skips prompt)", async () => {
    const { deps, logs, readLine } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "1.2.0",
      },
    });
    const result = await confirmRestartIfMismatch({ autoYes: true, deps });
    expect(result.proceed).toBe(true);
    expect(result.reason).toMatch(/--yes/);
    expect(readLine).not.toHaveBeenCalled();
    // Banner should still be surfaced so the user sees what just happened.
    expect(logs.some((l) => l.includes("1.1.0"))).toBe(true);
    expect(logs.some((l) => l.includes("1.2.0"))).toBe(true);
    expect(logs.some((l) => l.includes("--yes supplied"))).toBe(true);
  });

  it("aborts on mismatch when stdin is not a TTY and --yes is missing", async () => {
    const { deps, logs, readLine } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "1.2.0",
      },
      isTty: false,
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(false);
    expect(result.reason).toMatch(/non-interactive/);
    expect(readLine).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("--yes"))).toBe(true);
  });

  it("proceeds on mismatch when TTY user types 'y'", async () => {
    const { deps, readLine } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "1.2.0",
      },
      isTty: true,
      readLineAnswer: "y",
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(true);
    expect(result.reason).toMatch(/user confirmed/);
    expect(readLine).toHaveBeenCalledTimes(1);
  });

  it("proceeds on mismatch when TTY user types 'YES' (case + whitespace tolerant)", async () => {
    const { deps } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "1.2.0",
      },
      isTty: true,
      readLineAnswer: "  YES  ",
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(true);
  });

  it("aborts on mismatch when TTY user types 'n'", async () => {
    const { deps } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "1.2.0",
      },
      isTty: true,
      readLineAnswer: "n",
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(false);
    expect(result.reason).toMatch(/declined/);
  });

  it("aborts on mismatch when TTY user just hits enter (default = No)", async () => {
    const { deps } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "1.2.0",
      },
      isTty: true,
      readLineAnswer: "",
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(false);
    expect(result.reason).toMatch(/declined/);
  });

  it("aborts on mismatch when stdin closes before any answer (EOF)", async () => {
    const { deps } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "1.2.0",
      },
      isTty: true,
      readLineAnswer: null,
    });
    const result = await confirmRestartIfMismatch({ autoYes: false, deps });
    expect(result.proceed).toBe(false);
    expect(result.reason).toMatch(/declined/);
  });

  it("includes both versions in the mismatch banner so the user can compare", async () => {
    const { deps, logs } = makeHarness({
      probeResult: {
        status: "mismatch",
        daemonVersion: "1.1.0",
        serverVersion: "2.0.0",
      },
      isTty: true,
      readLineAnswer: "n",
    });
    await confirmRestartIfMismatch({ autoYes: false, deps });
    const banner = logs.find((l) => l.includes("PTY host protocol"));
    expect(banner).toBeDefined();
    expect(banner).toContain("2.0.0");
    expect(banner).toContain("1.1.0");
    expect(banner).toMatch(/terminate.*daemon/);
  });
});

describe("extractAutoYesFlag", () => {
  it("returns autoYes=false and unchanged args when neither flag is present", () => {
    const out = extractAutoYesFlag(["--all"]);
    expect(out.autoYes).toBe(false);
    expect(out.rest).toEqual(["--all"]);
  });

  it("recognizes --yes and strips it from rest", () => {
    const out = extractAutoYesFlag(["--yes", "--all"]);
    expect(out.autoYes).toBe(true);
    expect(out.rest).toEqual(["--all"]);
  });

  it("recognizes -y and strips it from rest", () => {
    const out = extractAutoYesFlag(["-y"]);
    expect(out.autoYes).toBe(true);
    expect(out.rest).toEqual([]);
  });

  it("strips both forms if both happen to be passed", () => {
    const out = extractAutoYesFlag(["-y", "--all", "--yes"]);
    expect(out.autoYes).toBe(true);
    expect(out.rest).toEqual(["--all"]);
  });
});

describe("readLineFromInput", () => {
  it("returns the typed line before readline close can resolve EOF", async () => {
    const input = new PassThrough();
    const line = readLineFromInput(input);

    input.end("y\n");

    await expect(line).resolves.toBe("y");
  });

  it("returns null when input closes before any answer", async () => {
    const input = new PassThrough();
    const line = readLineFromInput(input);

    input.end();

    await expect(line).resolves.toBeNull();
  });
});
