import { describe, expect, it } from "vitest";
import {
  clientBrowserStorageKey,
  isSafeBrowserUrl,
  parseClientBrowserStore,
} from "./client-browser-store.js";

describe("clientBrowserStorageKey", () => {
  it("namespaces by project id", () => {
    expect(clientBrowserStorageKey("p1")).toBe("parasor:client-browsers:p1");
  });
});

describe("parseClientBrowserStore", () => {
  it("returns empty object for null/empty input", () => {
    expect(parseClientBrowserStore(null)).toEqual({});
    expect(parseClientBrowserStore("")).toEqual({});
  });

  it("returns empty object for malformed JSON", () => {
    expect(parseClientBrowserStore("{")).toEqual({});
    expect(parseClientBrowserStore("[]")).toEqual({});
    expect(parseClientBrowserStore("null")).toEqual({});
  });

  it("rejects oversized payloads", () => {
    const huge = `"${"x".repeat(70 * 1024)}"`;
    expect(parseClientBrowserStore(huge)).toEqual({});
  });

  it("parses well-formed entries and drops invalid items", () => {
    const raw = JSON.stringify({
      "/repo": [
        { id: "browser:1", url: "https://example.com" },
        { id: 42, url: "https://example.org" },
        { id: "browser:2" },
        { id: "browser:3", url: "about:blank" },
      ],
      "/other": "not-an-array",
    });
    expect(parseClientBrowserStore(raw)).toEqual({
      "/repo": [
        { id: "browser:1", url: "https://example.com" },
        { id: "browser:3", url: "about:blank" },
      ],
    });
  });

  it("drops entries whose URL would execute in the iframe", () => {
    const raw = JSON.stringify({
      "/repo": [
        { id: "browser:js", url: "javascript:alert(1)" },
        { id: "browser:js-mixed", url: "JaVaScRiPt:alert(1)" },
        { id: "browser:js-pad", url: "  javascript:alert(1)" },
        { id: "browser:data", url: "data:text/html,<script>alert(1)</script>" },
        { id: "browser:vb", url: "vbscript:msgbox" },
        { id: "browser:file", url: "file:///etc/passwd" },
        { id: "browser:ok", url: "https://example.com" },
      ],
    });
    expect(parseClientBrowserStore(raw)).toEqual({
      "/repo": [{ id: "browser:ok", url: "https://example.com" }],
    });
  });
});

describe("isSafeBrowserUrl", () => {
  it("accepts http(s) and about:blank", () => {
    expect(isSafeBrowserUrl("http://example.com")).toBe(true);
    expect(isSafeBrowserUrl("https://example.com")).toBe(true);
    expect(isSafeBrowserUrl("HTTPS://EXAMPLE.COM")).toBe(true);
    expect(isSafeBrowserUrl("about:blank")).toBe(true);
  });

  it("rejects schemes that can execute in the iframe", () => {
    expect(isSafeBrowserUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeBrowserUrl(" JavaScript:alert(1) ")).toBe(false);
    expect(isSafeBrowserUrl("data:text/html,<script>alert(1)</script>")).toBe(
      false,
    );
    expect(isSafeBrowserUrl("vbscript:msgbox")).toBe(false);
    expect(isSafeBrowserUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeBrowserUrl("about:srcdoc")).toBe(false);
    expect(isSafeBrowserUrl("")).toBe(false);
  });
});
