import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clearTextureAtlas = vi.fn();
const addonDispose = vi.fn();
let onContextLossCb: (() => void) | null = null;
let throwWebgl = false;

vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      if (throwWebgl) throw new Error("webgl unavailable");
    }
    clearTextureAtlas = clearTextureAtlas;
    dispose = addonDispose;
    onContextLoss(cb: () => void) {
      onContextLossCb = cb;
    }
  },
}));

import { attachWebglRendererAndFontAtlas } from "./terminal-renderer-fonts.js";

type FakeTerm = {
  loadAddon: ReturnType<typeof vi.fn>;
  options: { fontFamily: string };
};

function fakeTerm(): FakeTerm {
  return { loadAddon: vi.fn(), options: { fontFamily: "MyFont" } };
}

function fakeFontSet() {
  return {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    load: vi.fn(() => Promise.resolve([])),
  };
}

let originalFonts: PropertyDescriptor | undefined;

function installFonts(fonts: unknown) {
  originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
  Object.defineProperty(document, "fonts", {
    value: fonts,
    configurable: true,
  });
}

describe("attachWebglRendererAndFontAtlas", () => {
  beforeEach(() => {
    onContextLossCb = null;
    throwWebgl = false;
    clearTextureAtlas.mockClear();
    addonDispose.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalFonts) {
      Object.defineProperty(document, "fonts", originalFonts);
      originalFonts = undefined;
    }
  });

  it("loads the WebGL addon onto the terminal", () => {
    installFonts(fakeFontSet());
    const term = fakeTerm();
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(term as any, { isIos: false });
    expect(term.loadAddon).toHaveBeenCalledTimes(1);
  });

  it("reports WebGL attach lifecycle", () => {
    installFonts(fakeFontSet());
    const events: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: false,
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "webgl-attach" }]);
  });

  it("skips the WebGL addon when disabled", () => {
    const fonts = fakeFontSet();
    installFonts(fonts);
    const term = fakeTerm();
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(term as any, {
      isIos: false,
      enableWebgl: false,
    });
    expect(term.loadAddon).not.toHaveBeenCalled();
    expect(fonts.addEventListener).toHaveBeenCalledWith(
      "loadingdone",
      expect.any(Function),
    );
  });

  it("reports WebGL skip when disabled", () => {
    installFonts(fakeFontSet());
    const events: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: false,
      enableWebgl: false,
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "webgl-skip", reason: "disabled" }]);
  });

  it("reports WebGL attach failure and keeps the DOM fallback", () => {
    installFonts(fakeFontSet());
    throwWebgl = true;
    const events: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: false,
      onEvent: (event) => events.push(event),
    });
    expect(events).toEqual([{ type: "webgl-error", reason: "unavailable" }]);
  });

  it("registers the loadingdone listener and detaches the same callback on cleanup", () => {
    const fonts = fakeFontSet();
    installFonts(fonts);
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    const cleanup = attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: false,
    });
    expect(fonts.addEventListener).toHaveBeenCalledWith(
      "loadingdone",
      expect.any(Function),
    );
    const registeredCb = fonts.addEventListener.mock.calls[0][1];
    cleanup();
    expect(fonts.removeEventListener).toHaveBeenCalledWith(
      "loadingdone",
      registeredCb,
    );
  });

  it("rebuilds the atlas on loadingdone (clear + fontFamily reassign)", () => {
    const fonts = fakeFontSet();
    installFonts(fonts);
    const term = fakeTerm();
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(term as any, { isIos: false });
    const onLoadingDone = fonts.addEventListener.mock.calls[0][1] as () => void;
    onLoadingDone();
    expect(clearTextureAtlas).toHaveBeenCalledTimes(1);
    expect(term.options.fontFamily).toBe("MyFont");
  });

  it("reports font loadingdone after atlas rebuild", () => {
    const fonts = fakeFontSet();
    installFonts(fonts);
    const events: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: false,
      onEvent: (event) => events.push(event),
    });
    const onLoadingDone = fonts.addEventListener.mock.calls[0][1] as () => void;
    onLoadingDone();
    expect(events).toEqual([
      { type: "webgl-attach" },
      { type: "font-loadingdone" },
    ]);
  });

  it("prefetches the Symbols Nerd Font (U+E0B0 sample) only on iOS after initial terminal paint", async () => {
    vi.useFakeTimers();
    const fonts = fakeFontSet();
    installFonts(fonts);
    const events: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: true,
      onEvent: (event) => events.push(event),
    });
    expect(fonts.load).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(fonts.load).toHaveBeenCalledWith('1em "Symbols Nerd Font"', "");
    expect(events).toEqual([
      { type: "webgl-attach" },
      { type: "ios-font-prefetch", status: "loaded" },
    ]);
    vi.useRealTimers();
  });

  it("reports failed iOS font prefetch", async () => {
    vi.useFakeTimers();
    const fonts = fakeFontSet();
    fonts.load.mockRejectedValueOnce(new Error("font load failed"));
    installFonts(fonts);
    const events: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: true,
      onEvent: (event) => events.push(event),
    });
    await vi.advanceTimersByTimeAsync(1000);
    expect(events).toEqual([
      { type: "webgl-attach" },
      { type: "ios-font-prefetch", status: "failed" },
    ]);
    vi.useRealTimers();
  });

  it("does not prefetch when not iOS", () => {
    const fonts = fakeFontSet();
    installFonts(fonts);
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, { isIos: false });
    expect(fonts.load).not.toHaveBeenCalled();
  });

  it("disposes the WebGL addon and nulls it on context loss", () => {
    installFonts(fakeFontSet());
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, { isIos: false });
    expect(onContextLossCb).toBeTypeOf("function");
    onContextLossCb?.();
    expect(addonDispose).toHaveBeenCalledTimes(1);
  });

  it("reports context loss after disposing the addon", () => {
    installFonts(fakeFontSet());
    const events: unknown[] = [];
    // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
    attachWebglRendererAndFontAtlas(fakeTerm() as any, {
      isIos: false,
      onEvent: (event) => events.push(event),
    });
    onContextLossCb?.();
    expect(events).toEqual([
      { type: "webgl-attach" },
      { type: "webgl-context-loss" },
    ]);
  });

  it("does not throw when document.fonts is unavailable", () => {
    installFonts(undefined);
    expect(() => {
      // biome-ignore lint/suspicious/noExplicitAny: minimal XTerm stub for the test
      const cleanup = attachWebglRendererAndFontAtlas(fakeTerm() as any, {
        isIos: true,
      });
      cleanup();
    }).not.toThrow();
  });
});
