import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOpenUrlTarget } from "./open-url-target.js";

const ORIG_WINDOW = globalThis.window;

function setLocationHost(host: string): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { hostname: host } } as Window & typeof globalThis,
  });
}

function restoreWindow(): void {
  if (ORIG_WINDOW === undefined) {
    // jsdom should always provide one, but keep the path defined for safety.
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: undefined,
    });
  } else {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: ORIG_WINDOW,
    });
  }
}

afterEach(() => {
  restoreWindow();
  vi.restoreAllMocks();
});

describe("resolveOpenUrlTarget", () => {
  beforeEach(() => {
    setLocationHost("phone.lan");
  });

  it("returns null for unparseable input", () => {
    expect(
      resolveOpenUrlTarget("not a url", undefined, () => undefined),
    ).toBeNull();
  });

  it("returns null for non-http(s) schemes", () => {
    expect(
      resolveOpenUrlTarget("javascript:alert(1)", undefined, () => undefined),
    ).toBeNull();
    expect(
      resolveOpenUrlTarget("ftp://example.com", undefined, () => undefined),
    ).toBeNull();
    expect(
      resolveOpenUrlTarget("file:///etc/passwd", undefined, () => undefined),
    ).toBeNull();
  });

  it("passes a public http(s) URL through unchanged without consulting findReachablePort", () => {
    const findReachablePort = vi.fn(() => undefined);
    expect(
      resolveOpenUrlTarget(
        "https://example.com/path?q=1",
        undefined,
        findReachablePort,
      ),
    ).toBe("https://example.com/path?q=1");
    expect(findReachablePort).not.toHaveBeenCalled();
  });

  it("loopback URL with explicit port asks findReachablePort with that port", () => {
    const findReachablePort = vi.fn(() => 51234);
    const out = resolveOpenUrlTarget(
      "http://localhost:5173/foo",
      undefined,
      findReachablePort,
    );
    expect(findReachablePort).toHaveBeenCalledWith(5173, undefined);
    expect(out).toBe("http://phone.lan:51234/foo");
  });

  it("loopback http URL without explicit port defaults devPort to 80", () => {
    const findReachablePort = vi.fn(() => 9090);
    resolveOpenUrlTarget("http://127.0.0.1/", undefined, findReachablePort);
    expect(findReachablePort).toHaveBeenCalledWith(80, undefined);
  });

  it("loopback https URL without explicit port defaults devPort to 443", () => {
    const findReachablePort = vi.fn(() => 9443);
    resolveOpenUrlTarget("https://localhost/", undefined, findReachablePort);
    expect(findReachablePort).toHaveBeenCalledWith(443, undefined);
  });

  it("forwards options.projectId to findReachablePort", () => {
    const findReachablePort = vi.fn(() => 42000);
    resolveOpenUrlTarget(
      "http://localhost:5173/",
      { projectId: "proj-1" },
      findReachablePort,
    );
    expect(findReachablePort).toHaveBeenCalledWith(5173, "proj-1");
  });

  it("[::1] loopback hostname is recognised", () => {
    const findReachablePort = vi.fn(() => 51234);
    resolveOpenUrlTarget("http://[::1]:5173/", undefined, findReachablePort);
    expect(findReachablePort).toHaveBeenCalledWith(5173, undefined);
  });

  it("returns original URL when reachable port lookup misses and pointer is precise", () => {
    const findReachablePort = vi.fn(() => undefined);
    const out = resolveOpenUrlTarget(
      "http://localhost:5173/",
      undefined,
      findReachablePort,
    );
    // No forwarder mapping known; precise pointer = no host-only fallback.
    expect(out).toBe("http://localhost:5173/");
  });

  it("does not call findReachablePort for a non-loopback host", () => {
    const findReachablePort = vi.fn(() => 1);
    resolveOpenUrlTarget("https://example.com/", undefined, findReachablePort);
    expect(findReachablePort).not.toHaveBeenCalled();
  });
});
