import type { WorktreeLocalFileCopyResult } from "@parasor/shared";
import { describe, expect, it } from "vitest";
import { summarizeLocalFileCopies } from "./worktree-copy-summary.js";

function result(
  status: WorktreeLocalFileCopyResult["status"],
  path = "f",
): WorktreeLocalFileCopyResult {
  return { path, status };
}

describe("summarizeLocalFileCopies", () => {
  it("returns null for undefined", () => {
    expect(summarizeLocalFileCopies(undefined)).toBeNull();
  });

  it("returns null for an empty array", () => {
    expect(summarizeLocalFileCopies([])).toBeNull();
  });

  it("summarizes a single copied file with the singular noun", () => {
    expect(summarizeLocalFileCopies([result("copied")])).toBe(
      "Copied 1 local file",
    );
  });

  it("uses the plural noun for multiple files", () => {
    expect(summarizeLocalFileCopies([result("copied"), result("copied")])).toBe(
      "Copied 2 local files",
    );
  });

  it("lists copied, skipped, and failed buckets in order", () => {
    expect(
      summarizeLocalFileCopies([
        result("copied"),
        result("copied"),
        result("skipped"),
        result("failed"),
      ]),
    ).toBe("Copied 2, skipped 1, failed 1 local files");
  });

  it("omits zero buckets (only skipped)", () => {
    expect(
      summarizeLocalFileCopies([result("skipped"), result("skipped")]),
    ).toBe("skipped 2 local files");
  });

  it("omits zero buckets (only failed)", () => {
    expect(summarizeLocalFileCopies([result("failed")])).toBe(
      "failed 1 local file",
    );
  });
});
