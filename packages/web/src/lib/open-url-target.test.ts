import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveOpenUrlTarget } from "./open-url-target.js";

afterEach(() => vi.unstubAllGlobals());

function setLocation(url: string) {
  vi.stubGlobal("window", { location: new URL(url) });
}

describe("resolveOpenUrlTarget", () => {
  it.each([
    "not a url",
    "javascript:alert(1)",
    "ftp://example.com",
    "file:///etc/passwd",
  ])("rejects invalid or non-HTTP input: %s", (url) => {
    expect(resolveOpenUrlTarget(url, undefined, () => undefined)).toBeNull();
  });

  it.each([
    "http://localhost:5173/path?q=1#fragment",
    "http://127.0.0.1:5173/",
    "http://[::1]:5173/",
    "http://0.0.0.0:5173/",
    "http://[::]:5173/",
    "http://phone.lan:5173/",
  ])("blocks remote preview links even with a stale reachable mapping: %s", (url) => {
    setLocation("http://phone.lan:7681");
    const lookup = vi.fn(() => 51234);
    expect(resolveOpenUrlTarget(url, { projectId: "p1" }, lookup)).toEqual({
      kind: "unreachable-loopback",
      port: 5173,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it.each([
    "http://localhost/",
    "https://localhost/",
  ])("reports the default port for %s", (url) => {
    setLocation("http://phone.lan:7681");
    expect(resolveOpenUrlTarget(url, undefined, () => undefined)).toEqual({
      kind: "unreachable-loopback",
      port: url.startsWith("https:") ? 443 : 80,
    });
  });

  it.each([
    "https://preview.example.test/path?q=1#fragment",
    "http://phone.lan:7681/sessions/demo",
  ])("allows a separate host or the control application itself: %s", (url) => {
    setLocation("http://phone.lan:7681");
    expect(resolveOpenUrlTarget(url, undefined, () => undefined)).toEqual({
      kind: "open",
      url,
    });
  });

  it.each([
    "http://localhost:7681",
    "http://127.0.0.1:7681",
    "http://[::1]:7681",
  ])("preserves local browser access from %s", (pageUrl) => {
    setLocation(pageUrl);
    expect(
      resolveOpenUrlTarget(
        "http://localhost:5173/",
        undefined,
        () => undefined,
      ),
    ).toEqual({
      kind: "open",
      url: "http://localhost:5173/",
    });
  });
});
