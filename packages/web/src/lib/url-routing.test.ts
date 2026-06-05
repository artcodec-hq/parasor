import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLoopbackHostname,
  isUnspecifiedHostname,
  resolveReachableBrowserUrl,
  shouldOpenInEmbeddedBrowser,
} from "./url-routing.js";

describe("isLoopbackHostname", () => {
  it("recognizes localhost, IPv4 loopback and IPv6 loopback literals", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("LOCALHOST")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("::1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("192.168.1.5")).toBe(false);
    expect(isLoopbackHostname("example.com")).toBe(false);
    expect(isLoopbackHostname("0.0.0.0")).toBe(false);
  });

  it("matches what URL.hostname produces for an IPv6 loopback URL", () => {
    expect(new URL("http://[::1]:5173").hostname).toBe("[::1]");
  });
});

describe("isUnspecifiedHostname", () => {
  it("recognizes the IPv4/IPv6 wildcard bind addresses only", () => {
    expect(isUnspecifiedHostname("0.0.0.0")).toBe(true);
    expect(isUnspecifiedHostname("[::]")).toBe(true);
    expect(isUnspecifiedHostname("localhost")).toBe(false);
    expect(isUnspecifiedHostname("127.0.0.1")).toBe(false);
    expect(isUnspecifiedHostname("192.168.1.5")).toBe(false);
  });

  it("matches what URL.hostname produces for an IPv6 wildcard URL", () => {
    expect(new URL("http://[::]:5173").hostname).toBe("[::]");
  });
});

describe("shouldOpenInEmbeddedBrowser", () => {
  it("keeps the existing embedded browser allowlist behavior", () => {
    expect(shouldOpenInEmbeddedBrowser("http://localhost:5173")).toBe(true);
    expect(shouldOpenInEmbeddedBrowser("http://127.0.0.1:3000/foo")).toBe(true);
    expect(shouldOpenInEmbeddedBrowser("http://[::1]:3000/foo")).toBe(true);
    expect(shouldOpenInEmbeddedBrowser("http://0.0.0.0:8080")).toBe(true);
    expect(shouldOpenInEmbeddedBrowser("http://[::]:8080")).toBe(true);
  });

  it("returns false for non-loopback hosts", () => {
    expect(shouldOpenInEmbeddedBrowser("https://example.com")).toBe(false);
  });

  it("returns false for unparseable input", () => {
    expect(shouldOpenInEmbeddedBrowser("not a url")).toBe(false);
  });

  it("honours an explicit allowlist", () => {
    expect(
      shouldOpenInEmbeddedBrowser("http://example.test:5173", ["example.test"]),
    ).toBe(true);
    expect(
      shouldOpenInEmbeddedBrowser("http://localhost:5173", ["other"]),
    ).toBe(false);
  });
});

describe("resolveReachableBrowserUrl", () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalWindow) {
      Object.defineProperty(globalThis, "window", {
        value: originalWindow,
        configurable: true,
        writable: true,
      });
    }
  });

  function stubHostname(hostname: string): void {
    vi.stubGlobal("window", { location: { hostname } });
  }

  it("rewrites host and port to the forwarder listen port when reachablePort is given", () => {
    stubHostname("100.64.0.5");
    expect(
      resolveReachableBrowserUrl("http://localhost:5173/app", {
        reachablePort: 49231,
      }),
    ).toBe("http://100.64.0.5:49231/app");
  });

  it("preserves path, query and hash when rewriting", () => {
    stubHostname("192.168.1.42");
    expect(
      resolveReachableBrowserUrl("http://localhost:5173/a/b?x=1&y=2#frag", {
        reachablePort: 49231,
      }),
    ).toBe("http://192.168.1.42:49231/a/b?x=1&y=2#frag");
    expect(
      resolveReachableBrowserUrl("http://127.0.0.1:3000/deep/path?q=z", {
        reachablePort: 49231,
      }),
    ).toBe("http://192.168.1.42:49231/deep/path?q=z");
  });

  it("leaves a loopback URL unchanged when there is no reachablePort", () => {
    stubHostname("192.168.1.42");
    expect(resolveReachableBrowserUrl("http://localhost:5173/app", {})).toBe(
      "http://localhost:5173/app",
    );
    expect(resolveReachableBrowserUrl("http://127.0.0.1:3000", {})).toBe(
      "http://127.0.0.1:3000",
    );
  });

  it("can host-swap a loopback URL without reachablePort for mobile fallback", () => {
    stubHostname("100.101.102.103");
    expect(
      resolveReachableBrowserUrl("http://localhost:5173/app?q=1#x", {
        fallbackToPageHostWithoutReachablePort: true,
      }),
    ).toBe("http://100.101.102.103:5173/app?q=1#x");
  });

  it("remaps an IPv6 loopback ([::1]) URL too", () => {
    stubHostname("192.168.1.42");
    expect(
      resolveReachableBrowserUrl("http://[::1]:5173/app", {
        reachablePort: 49231,
      }),
    ).toBe("http://192.168.1.42:49231/app");
    expect(resolveReachableBrowserUrl("http://[::1]:3000/x", {})).toBe(
      "http://[::1]:3000/x",
    );
  });

  it("swaps host but keeps the port for a wildcard-bind URL (no forwarder)", () => {
    stubHostname("192.168.1.42");
    expect(resolveReachableBrowserUrl("http://0.0.0.0:5173/app", {})).toBe(
      "http://192.168.1.42:5173/app",
    );
    expect(
      resolveReachableBrowserUrl("http://0.0.0.0:5173/app", {
        reachablePort: 49231,
      }),
    ).toBe("http://192.168.1.42:5173/app");
    expect(resolveReachableBrowserUrl("http://[::]:3000/x?q=1#h", {})).toBe(
      "http://192.168.1.42:3000/x?q=1#h",
    );
  });

  it("leaves a wildcard-bind URL alone when the page itself is loopback", () => {
    stubHostname("localhost");
    expect(resolveReachableBrowserUrl("http://0.0.0.0:5173", {})).toBe(
      "http://0.0.0.0:5173",
    );
  });

  it("leaves the URL unchanged when reachablePort is malformed", () => {
    stubHostname("192.168.1.42");
    for (const reachablePort of [Number.NaN, 0, 99999]) {
      expect(
        resolveReachableBrowserUrl("http://localhost:5173/app", {
          reachablePort,
        }),
      ).toBe("http://localhost:5173/app");
    }
  });

  it("leaves non-loopback URLs untouched (no forwarder substitution)", () => {
    stubHostname("192.168.1.42");
    expect(resolveReachableBrowserUrl("https://example.com/x", {})).toBe(
      "https://example.com/x",
    );
    expect(
      resolveReachableBrowserUrl("http://10.0.0.9:8080/y", {
        reachablePort: 49231,
      }),
    ).toBe("http://10.0.0.9:8080/y");
  });

  it("leaves the URL untouched when the page itself is loopback", () => {
    stubHostname("localhost");
    expect(
      resolveReachableBrowserUrl("http://localhost:5173", {
        reachablePort: 49231,
      }),
    ).toBe("http://localhost:5173");
  });

  it("returns the input unchanged for unparseable URLs", () => {
    stubHostname("192.168.1.42");
    expect(resolveReachableBrowserUrl("about:blank", {})).toBe("about:blank");
  });
});
