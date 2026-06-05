import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  UploadAbortedError,
  UploadInvalidFilenameError,
  UploadIoError,
  UploadTooLargeError,
  uploadDrops,
} from "./uploadDrops.js";

const originalFetch = globalThis.fetch;

function mockFetch(response: Response | Error): void {
  globalThis.fetch = vi
    .fn()
    .mockImplementation(() =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response),
    );
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFile(name: string, text: string): File {
  return new File([text], name, { type: "text/plain" });
}

describe("uploadDrops", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  it("returns the server paths on 200", async () => {
    mockFetch(
      jsonResponse(200, { paths: ["/tmp/parasor/uploads/sid-1/a.txt"] }),
    );
    const p = uploadDrops({
      projectId: "proj-1",
      sessionId: "sid-1",
      files: [makeFile("a.txt", "A")],
    });
    await vi.advanceTimersByTimeAsync(0);
    const paths = await p;
    expect(paths).toEqual(["/tmp/parasor/uploads/sid-1/a.txt"]);
  });

  it("posts to /drops with sessionId as a query param", async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { paths: [] }));
    globalThis.fetch = fetchSpy;
    await uploadDrops({
      projectId: "proj 1",
      sessionId: "sid/with weird chars",
      files: [makeFile("a.txt", "A")],
    });
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("/api/projects/proj%201/drops?sessionId=");
    expect(url).toContain("sessionId=sid%2Fwith%20weird%20chars");
  });

  it("returns empty synchronously when no files", async () => {
    const paths = await uploadDrops({
      projectId: "p",
      sessionId: "s",
      files: [],
    });
    expect(paths).toEqual([]);
  });

  it("maps 413 too-large into UploadTooLargeError with limit", async () => {
    mockFetch(jsonResponse(413, { error: "too-large", limit: 1024 }));
    await expect(
      uploadDrops({
        projectId: "p",
        sessionId: "s",
        files: [makeFile("big.txt", "X")],
      }),
    ).rejects.toBeInstanceOf(UploadTooLargeError);
  });

  it("maps 400 invalid-filename into UploadInvalidFilenameError", async () => {
    mockFetch(
      jsonResponse(400, {
        error: "invalid-filename",
        reason: "path-traversal",
      }),
    );
    const err = await uploadDrops({
      projectId: "p",
      sessionId: "s",
      files: [makeFile("../x.txt", "X")],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadInvalidFilenameError);
    expect((err as UploadInvalidFilenameError).reason).toBe("path-traversal");
  });

  it("maps 500 io-error into UploadIoError", async () => {
    mockFetch(jsonResponse(500, { error: "io-error" }));
    const err = await uploadDrops({
      projectId: "p",
      sessionId: "s",
      files: [makeFile("a.txt", "X")],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadIoError);
    expect((err as Error).message).toBe("io error");
  });

  it("wraps AbortError into UploadAbortedError", async () => {
    const abortError = new DOMException(
      "The user aborted a request.",
      "AbortError",
    );
    globalThis.fetch = vi.fn().mockRejectedValue(abortError);
    const err = await uploadDrops({
      projectId: "p",
      sessionId: "s",
      files: [makeFile("a.txt", "X")],
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UploadAbortedError);
  });

  it("invokes onSlow when the request takes over slowMs", async () => {
    let resolveRes: (r: Response) => void = () => {};
    const pending = new Promise<Response>((resolve) => {
      resolveRes = resolve;
    });
    globalThis.fetch = vi.fn().mockReturnValue(pending);

    const onSlow = vi.fn();
    const p = uploadDrops({
      projectId: "p",
      sessionId: "s",
      files: [makeFile("a.txt", "X")],
      onSlow,
      slowMs: 100,
    });

    await vi.advanceTimersByTimeAsync(99);
    expect(onSlow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(onSlow).toHaveBeenCalledOnce();

    resolveRes(jsonResponse(200, { paths: [] }));
    await p;
  });

  it("does not invoke onSlow when the request resolves quickly", async () => {
    mockFetch(jsonResponse(200, { paths: ["/x"] }));
    const onSlow = vi.fn();
    await uploadDrops({
      projectId: "p",
      sessionId: "s",
      files: [makeFile("a.txt", "X")],
      onSlow,
      slowMs: 500,
    });
    await vi.advanceTimersByTimeAsync(501);
    expect(onSlow).not.toHaveBeenCalled();
  });
});
