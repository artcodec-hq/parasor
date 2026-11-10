import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCli } from "./main.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const rootPackage = JSON.parse(
  readFileSync(join(testDir, "../../../../package.json"), "utf8"),
) as { version: string };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runCli version", () => {
  it.each([
    ["--version"],
    ["-v"],
    ["version"],
  ])("prints the app version for %s without starting the server", async (arg) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await runCli([arg]);

    expect(log).toHaveBeenCalledWith(rootPackage.version);
  });
});
