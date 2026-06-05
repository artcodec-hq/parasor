import { describe, expect, it } from "vitest";
import {
  UploadAbortedError,
  UploadInvalidFilenameError,
  UploadIoError,
  UploadTooLargeError,
} from "../../../lib/uploadDrops.js";
import {
  classifyHoverLabel,
  cleanUploadedPaths,
  uploadErrorMessage,
} from "./terminal-upload.js";

describe("classifyHoverLabel", () => {
  it("labels in-flight uploads", () => {
    expect(classifyHoverLabel({ status: "uploading" })).toBe(
      "Uploading files...",
    );
    expect(classifyHoverLabel({ status: "slow" })).toBe("Uploading files...");
  });

  it("returns null when idle or errored", () => {
    expect(classifyHoverLabel({ status: "idle" })).toBeNull();
    expect(classifyHoverLabel({ status: "error", message: "boom" })).toBeNull();
  });
});

describe("uploadErrorMessage", () => {
  it("returns null for an aborted upload", () => {
    expect(uploadErrorMessage(new UploadAbortedError())).toBeNull();
  });

  it("rounds the size limit to whole MB", () => {
    expect(uploadErrorMessage(new UploadTooLargeError(25 * 1024 * 1024))).toBe(
      "File too large (limit 25 MB)",
    );
    // 26.2 MB rounds to 26
    expect(uploadErrorMessage(new UploadTooLargeError(27_500_000))).toBe(
      "File too large (limit 26 MB)",
    );
  });

  it("floors sub-1MB limits to 1 MB", () => {
    expect(uploadErrorMessage(new UploadTooLargeError(1024))).toBe(
      "File too large (limit 1 MB)",
    );
  });

  it("surfaces the invalid-filename reason", () => {
    expect(
      uploadErrorMessage(new UploadInvalidFilenameError("contains slash")),
    ).toBe("Rejected filename: contains slash");
  });

  it("passes through io and generic error messages", () => {
    expect(uploadErrorMessage(new UploadIoError("disk full"))).toBe(
      "disk full",
    );
    expect(uploadErrorMessage(new Error("network down"))).toBe("network down");
  });

  it("falls back for non-Error values", () => {
    expect(uploadErrorMessage("nope")).toBe("Upload failed");
    expect(uploadErrorMessage(undefined)).toBe("Upload failed");
  });
});

describe("cleanUploadedPaths", () => {
  it("keeps valid paths in order", () => {
    expect(cleanUploadedPaths(["/a/b.txt", "/c/d.png"])).toEqual([
      "/a/b.txt",
      "/c/d.png",
    ]);
  });

  it("drops empty entries", () => {
    expect(cleanUploadedPaths(["", "/keep", ""])).toEqual(["/keep"]);
  });

  it("drops control-char-bearing paths (injection guard)", () => {
    expect(
      cleanUploadedPaths([
        "/ok",
        "/evil\nrm -rf",
        "/evil\rinject",
        "/evil\0null",
        "/also-ok",
      ]),
    ).toEqual(["/ok", "/also-ok"]);
  });
});
