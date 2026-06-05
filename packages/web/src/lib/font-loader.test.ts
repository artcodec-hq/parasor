import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetInjectedFontsForTests, injectFontFace } from "./font-loader.js";

describe("injectFontFace", () => {
  beforeEach(() => {
    __resetInjectedFontsForTests();
    document.head.innerHTML = "";
  });

  it("adds a FontFace via the document.fonts API when available", async () => {
    const addSpy = vi.fn();
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { FontFace: unknown }).FontFace = class {
      family: string;
      source: string;
      constructor(family: string, source: string) {
        this.family = family;
        this.source = source;
      }
      load = loadSpy;
    };
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add: addSpy },
    });

    await injectFontFace({
      family: "Test Mono",
      url: "/api/fonts/file/test",
    });

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it("is idempotent -- second call does not re-add the same family", async () => {
    const addSpy = vi.fn();
    const loadSpy = vi.fn().mockResolvedValue(undefined);
    (globalThis as unknown as { FontFace: unknown }).FontFace = class {
      load = loadSpy;
    };
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add: addSpy },
    });

    await injectFontFace({ family: "Dup", url: "/a" });
    await injectFontFace({ family: "Dup", url: "/a" });

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(addSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to a <style> tag when FontFace is unavailable", async () => {
    delete (globalThis as unknown as { FontFace?: unknown }).FontFace;
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: undefined,
    });

    await injectFontFace({
      family: "Fallback Mono",
      url: "/api/fonts/file/fb",
    });

    const style = document.head.querySelector("style");
    expect(style).toBeTruthy();
    expect(style?.textContent).toContain("Fallback Mono");
    expect(style?.textContent).toContain("/api/fonts/file/fb");
  });

  it("re-throws load failures so the caller can surface them", async () => {
    (globalThis as unknown as { FontFace: unknown }).FontFace = class {
      load = vi.fn().mockRejectedValue(new Error("network"));
    };
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: { add: vi.fn() },
    });

    await expect(injectFontFace({ family: "Bad", url: "/x" })).rejects.toThrow(
      /Failed to load font/,
    );
  });
});
