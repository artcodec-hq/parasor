import { afterEach, describe, expect, it, vi } from "vitest";
import { openHttpUrlInNewTab } from "./open-external-url.js";

describe("openHttpUrlInNewTab", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Spy on `<a>.click()` so jsdom does not attempt a (not-implemented)
  // navigation, and capture the anchors it was invoked on.
  function captureClickedAnchors(): HTMLAnchorElement[] {
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      anchors.push(this);
    });
    return anchors;
  }

  it("opens an http URL in a new tab with a hardened rel and referrer policy", () => {
    const anchors = captureClickedAnchors();
    openHttpUrlInNewTab("http://example.com/path?q=1#frag");

    expect(anchors).toHaveLength(1);
    const anchor = anchors[0];
    expect(anchor.href).toBe("http://example.com/path?q=1#frag");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    expect(anchor.referrerPolicy).toBe("no-referrer");
    expect(anchor.isConnected).toBe(false);
  });

  it("opens an https URL", () => {
    const anchors = captureClickedAnchors();
    openHttpUrlInNewTab("https://example.com");

    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe("https://example.com/");
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "ftp://example.com/file",
    "/relative/path",
    "not a url",
    "",
  ])("ignores non-http(s) or unparseable input (%j)", (url) => {
    const anchors = captureClickedAnchors();
    openHttpUrlInNewTab(url);

    expect(anchors).toHaveLength(0);
  });
});
