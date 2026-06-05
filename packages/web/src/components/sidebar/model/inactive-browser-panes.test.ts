import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientBrowserStorageKey } from "../../../lib/client-browser-store.js";
import { readClientBrowserChildPanes } from "./inactive-browser-panes.js";

// This jsdom config does not provide localStorage; install a Map-backed mock.
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, String(v));
    },
  };
}

describe("readClientBrowserChildPanes", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: makeStorage(),
    });
  });

  it("returns an empty per-path map for projects with no stored panes", () => {
    expect(readClientBrowserChildPanes([{ id: "p1" }, { id: "p2" }])).toEqual({
      p1: {},
      p2: {},
    });
  });

  it("projects stored browser panes into the inactive-child-pane shape", () => {
    window.localStorage.setItem(
      clientBrowserStorageKey("p1"),
      JSON.stringify({ "/w": [{ id: "b1", url: "https://example.com" }] }),
    );
    expect(readClientBrowserChildPanes([{ id: "p1" }])).toEqual({
      p1: { "/w": [{ id: "b1", kind: "browser", url: "https://example.com" }] },
    });
  });

  it("drops unsafe urls (delegated to the store parser)", () => {
    window.localStorage.setItem(
      clientBrowserStorageKey("p1"),
      JSON.stringify({
        "/w": [
          { id: "ok", url: "https://ok.test" },
          { id: "evil", url: "javascript:alert(1)" },
        ],
      }),
    );
    expect(readClientBrowserChildPanes([{ id: "p1" }]).p1["/w"]).toEqual([
      { id: "ok", kind: "browser", url: "https://ok.test" },
    ]);
  });

  it("keys results per project independently", () => {
    window.localStorage.setItem(
      clientBrowserStorageKey("p2"),
      JSON.stringify({ "/x": [{ id: "b", url: "https://b.test" }] }),
    );
    const result = readClientBrowserChildPanes([{ id: "p1" }, { id: "p2" }]);
    expect(result.p1).toEqual({});
    expect(result.p2["/x"]).toEqual([
      { id: "b", kind: "browser", url: "https://b.test" },
    ]);
  });

  it("treats a throwing localStorage as empty for that project", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readClientBrowserChildPanes([{ id: "p1" }])).toEqual({ p1: {} });
  });
});
