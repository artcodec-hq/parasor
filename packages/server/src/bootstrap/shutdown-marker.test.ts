import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readAndClearShutdownMarker,
  writeShutdownMarker,
} from "./shutdown-marker.js";

describe("shutdown marker", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "parasor-marker-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns false when no marker exists", () => {
    expect(readAndClearShutdownMarker(dir)).toBe(false);
  });

  it("returns true and clears the marker on read", () => {
    writeShutdownMarker(dir);
    expect(existsSync(join(dir, "shutdown.marker"))).toBe(true);
    expect(readAndClearShutdownMarker(dir)).toBe(true);
    expect(existsSync(join(dir, "shutdown.marker"))).toBe(false);
    expect(readAndClearShutdownMarker(dir)).toBe(false);
  });
});
