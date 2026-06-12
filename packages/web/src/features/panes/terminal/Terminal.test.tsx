import { act, cleanup, render } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";

const {
  MockXTerm,
  mockTermOpen,
  mockTermDispose,
  mockTermOnData,
  mockTermResize,
  mockTermRefresh,
  mockTermReset,
  mockTermSelect,
  mockTermClearSelection,
  mockTermGetSelection,
  mockTermGetSelectionPosition,
  mockTermHasSelection,
  mockTermGetLine,
  mockTermFocus,
  mockTermWrite,
  mockTermScrollToBottom,
  mockTermScrollToLine,
  mockTermScrollToTop,
  mockTermTextareaBlur,
  textareaEventListeners,
  scrollListeners,
  cursorMoveListeners,
  registeredLinkProviders,
  mockFitAddonFit,
  mockFitAddonProposeDimensions,
  mockSend,
  mockSendInit,
  mockUploadDrops,
  socketOptionsRef,
  mockSocketStatus,
  mockModes,
  customKeyHandlerRef,
} = vi.hoisted(() => {
  const mockTermOpen = vi.fn();
  const mockTermDispose = vi.fn();
  const mockTermOnData = vi.fn();
  const mockTermLoadAddon = vi.fn();
  const mockTermResize = vi.fn();
  const mockTermRefresh = vi.fn();
  const mockTermReset = vi.fn();
  const mockTermSelect = vi.fn();
  const mockTermClearSelection = vi.fn();
  const mockTermGetSelection = vi.fn().mockReturnValue("");
  const mockTermGetSelectionPosition = vi.fn().mockReturnValue(undefined);
  const mockTermHasSelection = vi.fn().mockReturnValue(false);
  const mockTermGetLine = vi.fn();
  const mockTermFocus = vi.fn();
  const mockTermWrite = vi.fn((_data: string, callback?: () => void) => {
    callback?.();
  });
  const mockTermScrollToBottom = vi.fn();
  const mockTermScrollToLine = vi.fn();
  const mockTermScrollToTop = vi.fn();
  const mockTermTextareaBlur = vi.fn();
  const textareaEventListeners = new Map<
    string,
    Array<(event: Event) => void>
  >();
  const scrollListeners: Array<() => void> = [];
  const cursorMoveListeners: Array<() => void> = [];
  const registeredLinkProviders: Array<{
    provideLinks: (
      bufferLineNumber: number,
      callback: (links: unknown[] | undefined) => void,
    ) => void;
  }> = [];
  const mockTermRegisterLinkProvider = vi.fn((provider) => {
    registeredLinkProviders.push(provider);
    return { dispose: vi.fn() };
  });
  const mockFitAddonFit = vi.fn();
  const mockFitAddonProposeDimensions = vi.fn();
  const mockSend = vi.fn();
  const mockSendInit = vi.fn();
  const mockUploadDrops = vi.fn();
  const mockSocketStatus: {
    current: "connecting" | "open" | "attached" | "reconnecting";
  } = {
    current: "attached",
  };
  const socketOptionsRef: {
    onData?: (data: string) => void;
    onFullReplay?: (
      lastSeen: { generation: number; seq: string } | null,
    ) => void;
    initialLastSeen?: { generation: number; seq: string } | null;
  } = {};
  const customKeyHandlerRef: {
    handler?: (event: KeyboardEvent) => boolean;
  } = {};
  const mockModes = {
    showCursor: true,
    synchronizedOutputMode: false,
    mouseTrackingMode: "none" as "none" | "x10" | "vt200" | "drag" | "any",
  };

  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  const MockXTerm = vi.fn(function (_options?: unknown) {
    return {
      open: (container: HTMLElement) => {
        mockTermOpen(container);
        const element = document.createElement("div");
        element.className = "xterm";
        const screen = document.createElement("div");
        screen.className = "xterm-screen";
        element.appendChild(screen);
        container.appendChild(element);
      },
      dispose: mockTermDispose,
      onData: mockTermOnData,
      onScroll: vi.fn((listener: () => void) => {
        scrollListeners.push(listener);
        return { dispose: vi.fn() };
      }),
      onCursorMove: vi.fn((listener: () => void) => {
        cursorMoveListeners.push(listener);
        return { dispose: vi.fn() };
      }),
      onSelectionChange: vi.fn().mockReturnValue({ dispose: vi.fn() }),
      scrollToBottom: mockTermScrollToBottom,
      scrollToLine: mockTermScrollToLine,
      scrollToTop: mockTermScrollToTop,
      getSelection: mockTermGetSelection,
      getSelectionPosition: mockTermGetSelectionPosition,
      hasSelection: mockTermHasSelection,
      clearSelection: mockTermClearSelection,
      selectLines: vi.fn(),
      loadAddon: mockTermLoadAddon,
      registerLinkProvider: mockTermRegisterLinkProvider,
      resize: mockTermResize,
      refresh: mockTermRefresh,
      reset: mockTermReset,
      select: mockTermSelect,
      focus: mockTermFocus,
      write: mockTermWrite,
      attachCustomKeyEventHandler: (
        handler: (event: KeyboardEvent) => boolean,
      ) => {
        customKeyHandlerRef.handler = handler;
      },
      buffer: {
        active: {
          viewportY: 5,
          baseY: 5,
          cursorX: 8,
          cursorY: 2,
          getLine: mockTermGetLine,
        },
      },
      textarea: {
        addEventListener: vi.fn((type: string, listener: EventListener) => {
          const listeners = textareaEventListeners.get(type) ?? [];
          listeners.push(listener);
          textareaEventListeners.set(type, listeners);
        }),
        removeEventListener: vi.fn((type: string, listener: EventListener) => {
          const listeners = textareaEventListeners.get(type) ?? [];
          textareaEventListeners.set(
            type,
            listeners.filter((candidate) => candidate !== listener),
          );
        }),
        blur: mockTermTextareaBlur,
      },
      get modes() {
        return mockModes;
      },
      element: null,
      cols: 80,
      rows: 24,
      options: {},
      unicode: { activeVersion: "6" as string, register: vi.fn() },
    };
  });

  return {
    MockXTerm,
    mockTermOpen,
    mockTermDispose,
    mockTermOnData,
    mockTermLoadAddon,
    mockTermResize,
    mockTermRefresh,
    mockTermReset,
    mockTermSelect,
    mockTermClearSelection,
    mockTermGetSelection,
    mockTermGetSelectionPosition,
    mockTermHasSelection,
    mockTermGetLine,
    mockTermFocus,
    mockTermWrite,
    mockTermScrollToBottom,
    mockTermScrollToLine,
    mockTermScrollToTop,
    mockTermTextareaBlur,
    textareaEventListeners,
    scrollListeners,
    cursorMoveListeners,
    registeredLinkProviders,
    mockFitAddonFit,
    mockFitAddonProposeDimensions,
    mockSend,
    mockSendInit,
    mockUploadDrops,
    socketOptionsRef,
    mockSocketStatus,
    mockModes,
    customKeyHandlerRef,
  };
});

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test value");
  return value;
}

function installStorage(name: "localStorage" | "sessionStorage"): Storage {
  const values = new Map<string, string>();
  const storage = {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, String(value)),
  } as Storage;
  Object.defineProperty(globalThis, name, {
    configurable: true,
    value: storage,
  });
  Object.defineProperty(window, name, { configurable: true, value: storage });
  return storage;
}

// `.xterm-screen` has zero size in jsdom (no layout); the touch-to-cell math
// needs a real rect. 800x240 over an 80x24 grid gives 10px per cell.
function mockScreenRect(screen: Element): void {
  Object.defineProperty(screen, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 800,
      height: 240,
      right: 800,
      bottom: 240,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  });
}

function customKeyHandler(): (event: KeyboardEvent) => boolean {
  return must(customKeyHandlerRef.handler);
}

function buttonByLabel(
  container: HTMLElement,
  label: string,
): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${label}"]`,
  );
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

async function flushAnimationFrame() {
  await act(
    () =>
      new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      }),
  );
}

vi.mock("@xterm/xterm", () => ({ Terminal: MockXTerm }));

vi.mock("@xterm/addon-fit", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  FitAddon: vi.fn(function () {
    return {
      fit: mockFitAddonFit,
      proposeDimensions: mockFitAddonProposeDimensions,
      dispose: vi.fn(),
    };
  }),
}));

vi.mock("@xterm/addon-webgl", () => ({
  // biome-ignore lint/complexity/useArrowFunction: Vitest constructor mocks must be constructable.
  WebglAddon: vi.fn(function () {
    return {
      dispose: vi.fn(),
      clearTextureAtlas: vi.fn(),
      onContextLoss: vi.fn(),
    };
  }),
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

vi.mock("../../../lib/open-external-url.js", () => ({
  openHttpUrlInNewTab: vi.fn(),
}));

vi.mock("../../../hooks/useTerminalSocket.js", () => ({
  useTerminalSocket: (options: {
    onData: (data: string) => void;
    onFullReplay?: (
      lastSeen: { generation: number; seq: string } | null,
    ) => void;
    initialLastSeen?: { generation: number; seq: string } | null;
  }) => {
    socketOptionsRef.onData = options.onData;
    socketOptionsRef.onFullReplay = options.onFullReplay;
    socketOptionsRef.initialLastSeen = options.initialLastSeen;
    return {
      send: mockSend,
      sendInit: mockSendInit,
      status: mockSocketStatus.current,
    };
  },
}));

vi.mock("../../../lib/uploadDrops.js", () => ({
  uploadDrops: mockUploadDrops,
}));

type ROCallback = (entries: ResizeObserverEntry[]) => void;
let roCallbacks: ROCallback[] = [];
let roInstances: { disconnect: Mock }[] = [];

class MockResizeObserver {
  private callback: ROCallback;
  disconnect = vi.fn();
  observe = vi.fn().mockImplementation(() => {
    roCallbacks.push(this.callback);
    roInstances.push(this);
  });
  unobserve = vi.fn();
  constructor(callback: ROCallback) {
    this.callback = callback;
  }
}

vi.stubGlobal("ResizeObserver", MockResizeObserver);

import { openHttpUrlInNewTab } from "../../../lib/open-external-url.js";
import { SettingsProvider } from "../../../lib/settings-context.js";
import {
  clearTerminalReplayCache,
  getTerminalReplayCache,
  setTerminalReplayCache,
} from "../../../lib/terminal-replay-cache.js";
import {
  disableTerminalTrace,
  enableTerminalTrace,
} from "../../../lib/terminal-trace.js";
import { Terminal } from "./Terminal.js";

const mockOpenHttpUrlInNewTab = vi.mocked(openHttpUrlInNewTab);
const TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY =
  "parasor:terminal-internal-clipboard";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

function makeTouchList(
  touches: Array<
    Partial<Touch> & Pick<Touch, "identifier" | "clientX" | "clientY">
  >,
): TouchList {
  return Object.assign(touches, {
    item: (index: number) => touches[index] ?? null,
  }) as unknown as TouchList;
}

function makeTouchEvent(
  type: string,
  touches: Array<
    Partial<Touch> & Pick<Touch, "identifier" | "clientX" | "clientY">
  >,
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touchList = makeTouchList(touches);
  Object.defineProperties(event, {
    touches: { value: touchList },
    changedTouches: { value: touchList },
  });
  return event;
}

function makeTouchEndEvent(
  changedTouches: Array<
    Partial<Touch> & Pick<Touch, "identifier" | "clientX" | "clientY">
  >,
): Event {
  const event = new Event("touchend", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: makeTouchList([]) },
    changedTouches: { value: makeTouchList(changedTouches) },
  });
  return event;
}

function makePointerEvent(
  type: string,
  init: { clientX: number; clientY: number; pointerId?: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    clientX: { value: init.clientX },
    clientY: { value: init.clientY },
    pointerId: { value: init.pointerId ?? 1 },
  });
  return event;
}

function makeToolbarTouchEndEvent(clientX: number, clientY: number): Event {
  const event = new Event("touchend", { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    touches: { value: makeTouchList([]) },
    changedTouches: {
      value: makeTouchList([{ identifier: 1, clientX, clientY }]),
    },
  });
  return event;
}

type MockCellSpec = { chars: string; width: number };

// One cell per glyph -- fine for ASCII/BMP test strings.
function cellsFromText(text: string): MockCellSpec[] {
  return Array.from(text).map((chars) => ({ chars, width: 1 }));
}

// Minimal `IBufferLine` over an explicit cell list, mirroring xterm's
// `getCell(x, cell?)` contract: a reusable `cell` arg is mutated in place. The
// trailing half of a wide glyph is width 0 with empty chars.
function makeBufferLine(cells: MockCellSpec[]): unknown {
  return {
    length: cells.length,
    getCell(x: number, cell?: Record<string, unknown>) {
      const spec = cells[x];
      if (!spec) return undefined;
      const target = cell ?? {};
      target.getChars = () => spec.chars;
      target.getWidth = () => spec.width;
      return target;
    },
  };
}

function makeTraceBufferLine(text: string, bg = 8): unknown {
  const chars = Array.from(text);
  return {
    isWrapped: false,
    length: chars.length,
    getCell(index: number) {
      if (index < 0 || index >= chars.length) return undefined;
      return {
        getChars: () => chars[index],
        getWidth: () => 1,
        getCode: () => chars[index]?.codePointAt(0) ?? 32,
        getFgColorMode: () => 0,
        getFgColor: () => 0,
        getBgColorMode: () => 1,
        getBgColor: () => bg,
        isBold: () => 0,
        isItalic: () => 0,
        isDim: () => 0,
        isUnderline: () => 0,
        isBlink: () => 0,
        isInverse: () => 0,
        isInvisible: () => 0,
        isStrikethrough: () => 0,
        isOverline: () => 0,
        isFgRGB: () => false,
        isBgRGB: () => false,
        isFgPalette: () => false,
        isBgPalette: () => true,
        isFgDefault: () => true,
        isBgDefault: () => false,
        isAttributeDefault: () => false,
        getUnderlineStyle: () => 0,
        getUnderlineColor: () => 0,
        getUnderlineColorMode: () => 0,
        isUnderlineColorRGB: () => false,
        isUnderlineColorPalette: () => false,
        isUnderlineColorDefault: () => true,
        attributesEquals: () => false,
      };
    },
    translateToString: (
      _trimRight?: boolean,
      startColumn = 0,
      endColumn = chars.length,
    ) => chars.slice(startColumn, endColumn).join(""),
  };
}

// A plain (no long-press, no drag) tap on the terminal screen at a cell.
function plainTapOnScreen(
  screen: Element,
  clientX: number,
  clientY: number,
): Event {
  const end = makeTouchEvent("touchend", [{ identifier: 1, clientX, clientY }]);
  act(() => {
    screen.dispatchEvent(
      makeTouchEvent("touchstart", [{ identifier: 1, clientX, clientY }]),
    );
    screen.dispatchEvent(end);
  });
  return end;
}

function dispatchOsFileDrop(target: HTMLElement): void {
  const file = new File(["data"], "drop.txt", { type: "text/plain" });
  const dataTransfer = {
    types: ["Files"],
    files: {
      length: 1,
      item: (index: number) => (index === 0 ? file : null),
    },
    getData: () => "",
    dropEffect: "none",
  };
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: dataTransfer,
  });
  target.dispatchEvent(event);
}

function dispatchClipboardImagePaste(): void {
  const listener = textareaEventListeners.get("paste")?.[0];
  if (!listener) throw new Error("missing paste listener");
  const file = new File(["png"], "image.png", { type: "image/png" });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => file,
        },
      ],
    },
  });
  listener(event);
}

describe("Terminal", () => {
  afterEach(() => {
    // Required: BottomSheet uses createPortal into document.body, and
    // without cleanup, leftover portals from a prior test pollute the
    // global DOM and contaminate `document.querySelectorAll` lookups.
    cleanup();
    vi.useRealTimers();
  });

  beforeEach(() => {
    installStorage("localStorage");
    installStorage("sessionStorage");
    vi.clearAllMocks();
    mockTermWrite.mockImplementation((_data: string, callback?: () => void) => {
      callback?.();
    });
    socketOptionsRef.onData = undefined;
    socketOptionsRef.onFullReplay = undefined;
    socketOptionsRef.initialLastSeen = undefined;
    mockUploadDrops.mockResolvedValue(["/tmp/uploaded.txt"]);
    clearTerminalReplayCache();
    textareaEventListeners.clear();
    scrollListeners.length = 0;
    cursorMoveListeners.length = 0;
    registeredLinkProviders.length = 0;
    mockSocketStatus.current = "attached";
    customKeyHandlerRef.handler = undefined;
    roCallbacks = [];
    roInstances = [];
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 100, rows: 30 });
    mockTermGetSelection.mockReturnValue("");
    mockTermGetSelectionPosition.mockReturnValue(undefined);
    mockTermHasSelection.mockReturnValue(false);
    mockTermGetLine.mockReturnValue(undefined);
    mockModes.showCursor = true;
    mockModes.synchronizedOutputMode = false;
    mockModes.mouseTrackingMode = "none";
    // jsdom does not run layout, so clientWidth/clientHeight default to 0.
    // The init guard treats zero-area containers as "not ready", which
    // would mask every valid-dims mount test. Provide a non-zero default
    // at the prototype level; individual tests that want a zero-area
    // container re-override clientWidth/Height on the container instance.
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return 800;
      },
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get() {
        return 600;
      },
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: undefined,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: undefined,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    localStorage.clear();
    sessionStorage.clear();
    window.parasorTerminalTrace?.clear();
    disableTerminalTrace();
    window.parasorTerminalTrace?.clear();
  });

  it("opens xterm immediately on mount", () => {
    render(<Terminal sessionId="s1" />, { wrapper });

    expect(MockXTerm).toHaveBeenCalledTimes(1);
    const options = MockXTerm.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("smoothScrollDuration");
    expect(mockTermOpen).toHaveBeenCalledTimes(1);
    expect(mockFitAddonFit).toHaveBeenCalled();
    expect(mockSendInit).toHaveBeenCalledWith(80, 24);
  });

  it("claims the shared PTY size on touch mount", () => {
    enableTerminalTrace();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({ matches: q === "(pointer: coarse)" }),
    });

    render(<Terminal sessionId="s1" />, { wrapper });

    expect(mockSendInit).toHaveBeenCalledWith(80, 24);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize", cols: 80, rows: 24 }),
    );
    expect(window.parasorTerminalTrace?.dump()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "terminal-viewport-claim",
          reason: "mount",
          cols: 80,
          rows: 24,
        }),
      ]),
    );
    expect(window.parasorTerminalTrace?.dump()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "terminal-visible-refresh",
          reason: "mount",
        }),
      ]),
    );
  });

  it("refreshes visible rows after synchronized output cursor movement settles", async () => {
    render(<Terminal sessionId="s1" />, { wrapper });

    mockTermRefresh.mockClear();
    mockModes.synchronizedOutputMode = true;

    act(() => {
      cursorMoveListeners[0]?.();
    });

    expect(mockTermRefresh).not.toHaveBeenCalled();

    mockModes.synchronizedOutputMode = false;
    await flushAnimationFrame();

    expect(mockTermRefresh).toHaveBeenCalledTimes(1);
    expect(mockTermRefresh).toHaveBeenCalledWith(0, 23);
  });

  it("does not refresh visible rows for ordinary cursor movement", async () => {
    render(<Terminal sessionId="s1" />, { wrapper });

    mockTermRefresh.mockClear();

    act(() => {
      cursorMoveListeners[0]?.();
    });
    await flushAnimationFrame();

    expect(mockTermRefresh).not.toHaveBeenCalled();
  });

  it("keeps the reconnect overlay hidden longer after mobile foreground", () => {
    vi.useFakeTimers({ now: 1000 });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    const { queryByText, rerender } = render(<Terminal sessionId="s1" />, {
      wrapper,
    });

    mockSend.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mockSend).not.toHaveBeenCalledWith({ type: "refresh" });

    mockSocketStatus.current = "reconnecting";
    rerender(<Terminal sessionId="s1" />);

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(queryByText("Reconnecting…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queryByText("Reconnecting…")).toBeTruthy();
  });

  it("shows a delayed connecting overlay while the initial socket is opening", () => {
    vi.useFakeTimers();
    mockSocketStatus.current = "connecting";

    const { queryByText } = render(<Terminal sessionId="s1" />, {
      wrapper,
    });

    act(() => {
      vi.advanceTimersByTime(749);
    });
    expect(queryByText("Connecting…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queryByText("Connecting…")).toBeTruthy();
    expect(queryByText("checking session")).toBeTruthy();
  });

  it("keeps the connecting overlay while the WebSocket is open but not attached", () => {
    vi.useFakeTimers();
    mockSocketStatus.current = "open";

    const { queryByText } = render(<Terminal sessionId="s1" />, {
      wrapper,
    });

    act(() => {
      vi.advanceTimersByTime(749);
    });
    expect(queryByText("Connecting…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queryByText("Connecting…")).toBeTruthy();
    expect(queryByText("checking session")).toBeTruthy();
  });

  it("shows a delayed restoring overlay while full replay data is pending", () => {
    vi.useFakeTimers();
    const { queryByText } = render(<Terminal sessionId="s1" />, {
      wrapper,
    });

    act(() => {
      socketOptionsRef.onFullReplay?.({ generation: 2, seq: "42" });
    });

    act(() => {
      vi.advanceTimersByTime(249);
    });
    expect(queryByText("Restoring…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queryByText("Restoring…")).toBeTruthy();
    expect(queryByText("loading terminal history")).toBeTruthy();

    act(() => {
      socketOptionsRef.onData?.("snapshot");
    });
    expect(queryByText("Restoring…")).toBeNull();
  });

  it("does not override xterm smooth scrolling on touch-primary devices", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });

    render(<Terminal sessionId="s1" />, { wrapper });

    const options = MockXTerm.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("smoothScrollDuration");
  });

  it("resets xterm before writing a full replay snapshot and refreshes after write", () => {
    render(<Terminal sessionId="s1" />, { wrapper });

    act(() => {
      socketOptionsRef.onFullReplay?.({ generation: 2, seq: "42" });
      socketOptionsRef.onData?.("snapshot");
    });

    expect(mockTermReset).toHaveBeenCalledTimes(1);
    expect(mockTermWrite).toHaveBeenCalledWith(
      "snapshot",
      expect.any(Function),
    );
    expect(mockTermRefresh).toHaveBeenCalledWith(0, 23);
    expect(mockTermReset.mock.invocationCallOrder[0]).toBeLessThan(
      mockTermWrite.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(mockTermWrite.mock.invocationCallOrder[0]).toBeLessThan(
      mockTermRefresh.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(getTerminalReplayCache("s1")).toEqual(
      expect.objectContaining({
        data: "snapshot",
        lastSeen: { generation: 2, seq: "42" },
      }),
    );
  });

  it("keeps the current terminal screen until full replay bytes arrive", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    mockTermReset.mockClear();

    act(() => {
      socketOptionsRef.onFullReplay?.({ generation: 2, seq: "42" });
    });
    expect(mockTermReset).not.toHaveBeenCalled();
    expect(mockTermWrite).not.toHaveBeenCalledWith(
      "snapshot",
      expect.any(Function),
    );

    act(() => {
      socketOptionsRef.onData?.("snapshot");
    });
    expect(mockTermReset).toHaveBeenCalledTimes(1);
    expect(mockTermWrite).toHaveBeenCalledWith(
      "snapshot",
      expect.any(Function),
    );
  });

  it("keeps replay reset scroll events from triggering older-history load", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            text: "expanded",
            replayBytes: 8,
            maxBytes: 512 * 1024,
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 8;
    scrollListeners[0]?.();
    await flushAnimationFrame();

    term.buffer.active.viewportY = 60;
    act(() => {
      socketOptionsRef.onFullReplay?.({ generation: 2, seq: "42" });
    });
    term.buffer.active.viewportY = 0;
    term.buffer.active.baseY = 60;
    scrollListeners[0]?.();
    await flushAnimationFrame();
    await act(async () => {
      await Promise.resolve();
    });

    const scrollbackCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/scrollback-snapshot?"),
    );
    expect(scrollbackCalls).toHaveLength(0);

    act(() => {
      socketOptionsRef.onData?.("snapshot");
    });
    expect(mockTermScrollToBottom).toHaveBeenCalled();
  });

  it("restores the full replay viewport anchor when the user was scrolled up", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };
    term.buffer.active.baseY = 100;
    term.buffer.active.viewportY = 80;
    mockTermWrite.mockImplementation((data: string, callback?: () => void) => {
      if (data === "snapshot") {
        term.buffer.active.baseY = 130;
        term.buffer.active.viewportY = 0;
      }
      callback?.();
    });

    act(() => {
      socketOptionsRef.onFullReplay?.({ generation: 2, seq: "42" });
      socketOptionsRef.onData?.("snapshot");
    });

    expect(mockTermScrollToLine).toHaveBeenCalledWith(110);
    expect(mockTermScrollToBottom).not.toHaveBeenCalled();
  });

  it("drops queued normal output when an authoritative full replay starts", async () => {
    render(<Terminal sessionId="s1" />, { wrapper });

    act(() => {
      socketOptionsRef.onData?.("stale");
      socketOptionsRef.onFullReplay?.({ generation: 2, seq: "42" });
      socketOptionsRef.onData?.("snapshot");
    });
    await flushAnimationFrame();

    expect(mockTermWrite).toHaveBeenCalledTimes(1);
    expect(mockTermWrite).toHaveBeenCalledWith(
      "snapshot",
      expect.any(Function),
    );
    expect(mockTermWrite).not.toHaveBeenCalledWith("stale");
  });

  it("restores a cached replay before socket data and passes its cursor to init", () => {
    setTerminalReplayCache("s-cached", {
      data: "cached snapshot",
      lastSeen: { generation: 8, seq: "123" },
    });

    render(<Terminal sessionId="s-cached" />, { wrapper });

    expect(socketOptionsRef.initialLastSeen).toEqual({
      generation: 8,
      seq: "123",
    });
    expect(mockTermReset).toHaveBeenCalledTimes(1);
    expect(mockTermWrite).toHaveBeenCalledWith(
      "cached snapshot",
      expect.any(Function),
    );
    const fitOrder = mockFitAddonFit.mock.invocationCallOrder[0];
    const cachedWriteOrder = mockTermWrite.mock.invocationCallOrder.find(
      (_order, index) =>
        mockTermWrite.mock.calls[index]?.[0] === "cached snapshot",
    );
    expect(fitOrder).toBeLessThan(cachedWriteOrder ?? Number.POSITIVE_INFINITY);
    expect(mockTermRefresh).toHaveBeenCalledWith(0, 23);
  });

  it("loads an expanded scrollback snapshot when the user scrolls near the top", async () => {
    enableTerminalTrace();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            text: "expanded history\nlatest prompt",
            replayBytes: 30,
            maxBytes: 512 * 1024,
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    let term:
      | { buffer: { active: { viewportY: number; baseY: number } } }
      | undefined;
    mockTermWrite.mockImplementation((data: string, callback?: () => void) => {
      if (data === "expanded history\nlatest prompt" && term) {
        term.buffer.active.baseY = 35;
      }
      callback?.();
    });
    const { getByLabelText } = render(<Terminal sessionId="s1" />, {
      wrapper,
    });
    const renderedTerm = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };
    term = renderedTerm;

    renderedTerm.buffer.active.baseY = 20;
    renderedTerm.buffer.active.viewportY = 8;
    scrollListeners[0]?.();
    await flushAnimationFrame();

    renderedTerm.buffer.active.viewportY = 0;
    scrollListeners[0]?.();
    await flushAnimationFrame();
    await act(async () => {
      await Promise.resolve();
    });

    const scrollbackCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/scrollback-snapshot?"),
    );
    expect(scrollbackCalls).toHaveLength(1);
    expect(String(scrollbackCalls[0]?.[0])).toContain(
      "/api/sessions/s1/scrollback-snapshot?",
    );
    expect(String(scrollbackCalls[0]?.[0])).toContain("maxBytes=524288");
    expect(mockTermReset).toHaveBeenCalled();
    expect(mockTermWrite).toHaveBeenCalledWith(
      "expanded history\nlatest prompt",
      expect.any(Function),
    );
    expect(getByLabelText("Load older terminal history")).toBeTruthy();
    expect(mockTermScrollToTop).not.toHaveBeenCalled();
    expect(mockTermScrollToLine).toHaveBeenCalledWith(15);
    expect(window.parasorTerminalTrace?.dump()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "xterm-history-scroll-restore",
          sessionId: "s1",
          previousViewportY: 0,
          previousBaseY: 20,
          baseY: 35,
          targetViewportY: 15,
        }),
      ]),
    );
    expect(mockSend).toHaveBeenCalledWith({ type: "refresh" });
  });

  it("does not issue duplicate older-history requests while one is in flight", async () => {
    let resolveFetch: (res: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    term.buffer.active.baseY = 20;
    term.buffer.active.viewportY = 8;
    scrollListeners[0]?.();
    await flushAnimationFrame();

    term.buffer.active.viewportY = 0;
    scrollListeners[0]?.();
    await flushAnimationFrame();
    term.buffer.active.viewportY = 8;
    scrollListeners[0]?.();
    await flushAnimationFrame();
    term.buffer.active.viewportY = 0;
    scrollListeners[0]?.();
    await flushAnimationFrame();

    const scrollbackCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/scrollback-snapshot?"),
    );
    expect(scrollbackCalls).toHaveLength(1);

    resolveFetch(
      new Response(
        JSON.stringify({
          text: "expanded",
          replayBytes: 8,
          maxBytes: 512 * 1024,
          hasMore: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await act(async () => {
      await Promise.resolve();
    });
  });

  it("does not auto-load older history when keyboard resize reports top scroll", async () => {
    let viewportResize: (() => void) | null = null;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 500,
        offsetTop: 0,
        addEventListener: (type: string, cb: () => void) => {
          if (type === "resize") viewportResize = cb;
        },
        removeEventListener: vi.fn(),
      },
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            text: "expanded",
            replayBytes: 8,
            maxBytes: 512 * 1024,
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    term.buffer.active.baseY = 20;
    term.buffer.active.viewportY = 8;
    scrollListeners[0]?.();
    await flushAnimationFrame();

    await act(async () => {
      viewportResize?.();
    });
    term.buffer.active.viewportY = 0;
    scrollListeners[0]?.();
    await flushAnimationFrame();
    await act(async () => {
      await Promise.resolve();
    });

    const scrollbackCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/scrollback-snapshot?"),
    );
    expect(scrollbackCalls).toHaveLength(0);
  });

  it("restores the jump-to-bottom button when scrolled away from the tail", async () => {
    const { getByLabelText, queryByLabelText } = render(
      <Terminal sessionId="s1" />,
      { wrapper },
    );
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    expect(queryByLabelText("Scroll to bottom")).toBeNull();

    term.buffer.active.baseY = 20;
    term.buffer.active.viewportY = 12;
    scrollListeners[0]?.();
    await flushAnimationFrame();

    act(() => {
      getByLabelText("Scroll to bottom").click();
    });
    expect(mockTermScrollToBottom).toHaveBeenCalledTimes(1);

    term.buffer.active.viewportY = 20;
    scrollListeners[0]?.();
    await flushAnimationFrame();

    expect(queryByLabelText("Scroll to bottom")).toBeNull();
  });

  it("batches normal terminal output chunks into one xterm write per frame", async () => {
    render(<Terminal sessionId="s1" />, { wrapper });

    act(() => {
      socketOptionsRef.onData?.("alpha");
      socketOptionsRef.onData?.("beta");
      socketOptionsRef.onData?.("gamma");
    });

    expect(mockTermWrite).not.toHaveBeenCalled();

    await flushAnimationFrame();

    expect(mockTermWrite).toHaveBeenCalledTimes(1);
    expect(mockTermWrite).toHaveBeenCalledWith("alphabetagamma");
  });

  it("pauses and resumes terminal output when xterm write callbacks backlog", async () => {
    const callbacks: Array<() => void> = [];
    mockTermWrite.mockImplementation((_data: string, callback?: () => void) => {
      if (callback) callbacks.push(callback);
    });

    render(<Terminal sessionId="s1" />, { wrapper });

    const chunk = "x".repeat(100_000);
    for (let i = 0; i < 6; i++) {
      act(() => {
        socketOptionsRef.onData?.(chunk);
      });
      await flushAnimationFrame();
    }

    expect(callbacks).toHaveLength(6);
    expect(mockSend).toHaveBeenCalledWith({ type: "flow-pause" });
    expect(mockSend).not.toHaveBeenCalledWith({ type: "flow-resume" });

    mockSend.mockClear();
    act(() => {
      for (let i = 0; i < 4; i++) {
        callbacks.shift()?.();
      }
    });

    expect(mockSend).toHaveBeenCalledWith({ type: "flow-resume" });
    mockTermWrite.mockImplementation((_data: string, callback?: () => void) => {
      callback?.();
    });
  });

  it("sets up resize observer", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });

    expect(roCallbacks.length).toBe(1);

    mockFitAddonFit.mockClear();
    mockSend.mockClear();

    const container = must(document.querySelector("[class*='h-full']"));
    Object.defineProperty(container, "clientWidth", {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(container, "clientHeight", {
      value: 600,
      configurable: true,
    });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).toHaveBeenCalledWith(100, 30);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize" }),
    );
    vi.useRealTimers();
  });

  it("defers terminal resize until the mobile viewport settles", () => {
    vi.useFakeTimers();
    let viewportResize: (() => void) | null = null;
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 500,
        offsetTop: 0,
        addEventListener: (type: string, cb: () => void) => {
          if (type === "resize") viewportResize = cb;
        },
        removeEventListener: vi.fn(),
      },
    });

    render(<Terminal sessionId="s1" />, { wrapper });
    mockTermResize.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 42, rows: 18 });

    act(() => {
      viewportResize?.();
    });
    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(60);
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(59);
    });
    expect(mockTermResize).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(mockTermResize).toHaveBeenCalledTimes(1);
    expect(mockTermResize).toHaveBeenCalledWith(42, 18);
    expect(mockTermRefresh).toHaveBeenCalledWith(0, 23);
    vi.useRealTimers();
  });

  it("keeps virtual-keyboard padding off the FitAddon measurement container", async () => {
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: {
        height: 500,
        offsetTop: 0,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    });

    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    await flushAnimationFrame();

    const root = must(container.firstElementChild as HTMLElement | null);
    const fitContainer = must(
      mockTermOpen.mock.calls[0]?.[0] as HTMLElement | undefined,
    );
    expect(root.style.paddingBottom).toBe("300px");
    expect(fitContainer.style.paddingBottom).toBe("");
  });

  it("keeps the prompt visible when resizing while already at the bottom", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });

    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 42, rows: 18 });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).toHaveBeenCalledWith(42, 18);
    expect(mockTermScrollToBottom).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("restores viewport position when resize moves a scrolled terminal to the top", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    term.buffer.active.baseY = 40;
    term.buffer.active.viewportY = 18;
    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockTermScrollToLine.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 42, rows: 18 });
    mockTermResize.mockImplementationOnce(() => {
      term.buffer.active.viewportY = 0;
    });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).toHaveBeenCalledWith(42, 18);
    expect(mockTermScrollToBottom).not.toHaveBeenCalled();
    expect(mockTermScrollToLine).toHaveBeenCalledWith(18);
    vi.useRealTimers();
  });

  it("keeps middle scroll anchored when keyboard resize changes the scrollback base", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 22;
    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockTermScrollToLine.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 18 });
    mockTermResize.mockImplementationOnce(() => {
      term.buffer.active.baseY = 69;
      term.buffer.active.viewportY = 0;
    });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).toHaveBeenCalledWith(80, 18);
    expect(mockTermScrollToBottom).not.toHaveBeenCalled();
    expect(mockTermScrollToLine).toHaveBeenCalledWith(31);
    vi.useRealTimers();
  });

  it("scrolls to the input line and resizes the PTY when a touch keyboard shrinks the terminal", () => {
    // On touch, a row-shrinking resize is the on-screen keyboard opening =
    // input mode: jump to the live tail (cursor) regardless of prior scroll
    // position. This re-engages tail-following so the PTY's SIGWINCH redraw
    // can't strand the viewport at the top (the real-device "keyboard open ->
    // jumps to top" bug).
    vi.useFakeTimers();
    enableTerminalTrace();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({ matches: q === "(pointer: coarse)" }),
    });
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    // Scrolled up in history when the keyboard opens (fewer rows than 24).
    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 22;
    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockTermScrollToLine.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 18 });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).toHaveBeenCalledWith(80, 18);
    expect(mockTermScrollToBottom).toHaveBeenCalled();
    expect(mockTermScrollToLine).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize" }),
    );
    expect(
      window.parasorTerminalTrace
        ?.dump()
        .find((event) => event.type === "terminal-resize-apply"),
    ).toEqual(
      expect.objectContaining({
        reason: "keyboard-open-bottom",
        ptyResizeSent: true,
      }),
    );
    vi.useRealTimers();
  });

  it("still sends a PTY resize when a touch keyboard shrink changes columns", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({ matches: q === "(pointer: coarse)" }),
    });
    render(<Terminal sessionId="s1" />, { wrapper });

    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 90, rows: 18 });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).toHaveBeenCalledWith(90, 18);
    expect(mockTermScrollToBottom).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize" }),
    );
    vi.useRealTimers();
  });

  it("keeps the reading position when the keyboard closes (only opening forces bottom)", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (q: string) => ({ matches: q === "(pointer: coarse)" }),
    });
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    // Scrolled up in history; the keyboard then closes (rows grow back > 24).
    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 22;
    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockTermScrollToLine.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 30 });
    // xterm shifts the viewport during the resize; anchor restore must put it
    // back to the reading position, not jump to bottom.
    mockTermResize.mockImplementationOnce(() => {
      term.buffer.active.viewportY = 0;
    });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).toHaveBeenCalledWith(80, 30);
    expect(mockTermScrollToBottom).not.toHaveBeenCalled();
    expect(mockTermScrollToLine).toHaveBeenCalledWith(22);
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize" }),
    );
    vi.useRealTimers();
  });

  it("claims the terminal width on desktop when the cursor enters, not on bare focus", () => {
    // Non-touch (no matchMedia mock -> isTouch false). The shared PTY width is
    // claimed only on engagement: desktop = cursor entering the terminal.
    render(<Terminal sessionId="s1" />, { wrapper });
    const termContainer = must(document.querySelector(".xterm")).parentElement;
    mockTermResize.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 90, rows: 30 });

    // A bare window focus (alt-tab back) must NOT re-claim the width.
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(mockTermResize).not.toHaveBeenCalled();

    // The cursor entering the terminal claims it (fits + resizes the PTY).
    act(() => {
      termContainer?.dispatchEvent(new MouseEvent("mouseenter"));
    });
    expect(mockTermResize).toHaveBeenCalledWith(90, 30);
  });

  it("re-claims the shared PTY width on cursor enter even when the local size is unchanged", () => {
    // The shared PTY may hold another device's width. Engaging must push this
    // device's size to the PTY even though the local xterm already matches it,
    // otherwise the "unchanged" check would never reclaim it.
    render(<Terminal sessionId="s1" />, { wrapper });
    const termContainer = must(document.querySelector(".xterm")).parentElement;
    mockTermResize.mockClear();
    mockSend.mockClear();
    // proposeDimensions equals the mock xterm's fixed 80x24 -> locally unchanged.
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 24 });

    act(() => {
      termContainer?.dispatchEvent(new MouseEvent("mouseenter"));
    });

    expect(mockTermResize).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize", cols: 80, rows: 24 }),
    );
  });

  it("pins to bottom during an unchanged desktop claim only when already at bottom", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };
    const termContainer = must(document.querySelector(".xterm")).parentElement;

    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 60;
    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 24 });

    act(() => {
      termContainer?.dispatchEvent(new MouseEvent("mouseenter"));
    });

    expect(mockTermResize).not.toHaveBeenCalled();
    expect(mockTermScrollToBottom).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize", cols: 80, rows: 24 }),
    );
    vi.useRealTimers();
  });

  it("keeps reading position during an unchanged desktop claim when scrolled up", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };
    const termContainer = must(document.querySelector(".xterm")).parentElement;

    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 22;
    mockTermResize.mockClear();
    mockTermScrollToBottom.mockClear();
    mockSend.mockClear();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 24 });

    act(() => {
      termContainer?.dispatchEvent(new MouseEvent("mouseenter"));
    });

    expect(mockTermResize).not.toHaveBeenCalled();
    expect(mockTermScrollToBottom).not.toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize", cols: 80, rows: 24 }),
    );
  });

  it("does not auto-load older history when keyboard close reports top scroll immediately", async () => {
    vi.useFakeTimers();
    let viewportResize: (() => void) | null = null;
    const visualViewport = {
      height: 500,
      offsetTop: 0,
      addEventListener: (type: string, cb: () => void) => {
        if (type === "resize") viewportResize = cb;
      },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            text: "expanded",
            replayBytes: 8,
            maxBytes: 512 * 1024,
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    term.buffer.active.baseY = 20;
    term.buffer.active.viewportY = 8;
    act(() => {
      scrollListeners[0]?.();
      vi.advanceTimersByTime(16);
    });

    act(() => {
      visualViewport.height = 800;
      viewportResize?.();
      term.buffer.active.viewportY = 0;
      scrollListeners[0]?.();
      vi.advanceTimersByTime(16);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const scrollbackCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/scrollback-snapshot?"),
    );
    expect(scrollbackCalls).toHaveLength(0);
    vi.useRealTimers();
  });

  it("does not auto-load older history from a top scroll immediately after resize refresh", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            text: "expanded",
            replayBytes: 8,
            maxBytes: 512 * 1024,
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 8;
    act(() => {
      scrollListeners[0]?.();
      vi.advanceTimersByTime(16);
    });

    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 18 });
    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    term.buffer.active.baseY = 28;
    term.buffer.active.viewportY = 0;
    act(() => {
      scrollListeners[0]?.();
      vi.advanceTimersByTime(16);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const scrollbackCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/scrollback-snapshot?"),
    );
    expect(scrollbackCalls).toHaveLength(0);
    vi.useRealTimers();
  });

  it("suppresses top-scroll history load after the keyboard settles even when no resize applies", async () => {
    vi.useFakeTimers();
    let viewportResize: (() => void) | null = null;
    const visualViewport = {
      height: 500,
      offsetTop: 0,
      addEventListener: (type: string, cb: () => void) => {
        if (type === "resize") viewportResize = cb;
      },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: visualViewport,
    });
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            text: "expanded",
            replayBytes: 8,
            maxBytes: 512 * 1024,
            hasMore: true,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<Terminal sessionId="s1" />, { wrapper });
    const term = MockXTerm.mock.results[0]?.value as {
      buffer: { active: { viewportY: number; baseY: number } };
    };

    // Arm the older-history loader by scrolling away from the top once.
    term.buffer.active.baseY = 60;
    term.buffer.active.viewportY = 8;
    act(() => {
      scrollListeners[0]?.();
      vi.advanceTimersByTime(16);
    });

    // Keyboard opens and settles WITHOUT any ResizeObserver dimension change,
    // so the deferred flush applies no resize and `onResizeApplied` never
    // fires. The settle edge alone must still arm the suppression window.
    // Advance well past the legacy 250ms-from-open window (now ~530ms in) so
    // this only passes because the window is anchored to settle completion.
    act(() => {
      viewportResize?.();
    });
    act(() => {
      vi.advanceTimersByTime(530);
    });

    term.buffer.active.viewportY = 0;
    act(() => {
      scrollListeners[0]?.();
      vi.advanceTimersByTime(16);
    });
    await act(async () => {
      await Promise.resolve();
    });

    const scrollbackCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes("/scrollback-snapshot?"),
    );
    expect(scrollbackCalls).toHaveLength(0);
    vi.useRealTimers();
  });

  it("records terminal resize observer and apply timings when trace is enabled", () => {
    vi.useFakeTimers();
    enableTerminalTrace();
    render(<Terminal sessionId="s-resize-trace" />, { wrapper });

    mockFitAddonProposeDimensions.mockReturnValue({ cols: 42, rows: 18 });

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    const trace = window.parasorTerminalTrace?.dump() ?? [];
    expect(trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "terminal-resize-observed",
          sessionId: "s-resize-trace",
          skipped: false,
        }),
        expect.objectContaining({
          type: "terminal-resize-apply",
          sessionId: "s-resize-trace",
          proposedCols: 42,
          proposedRows: 18,
        }),
      ]),
    );
    expect(
      trace.find((event) => event.type === "terminal-resize-apply"),
    ).toEqual(
      expect.objectContaining({
        durationMs: expect.any(Number),
        proposeDurationMs: expect.any(Number),
        resizeDurationMs: expect.any(Number),
      }),
    );
    vi.useRealTimers();
  });

  it("refreshes visible rows when layout is valid but cols and rows are unchanged", () => {
    vi.useFakeTimers();
    mockFitAddonProposeDimensions.mockReturnValue({ cols: 80, rows: 24 });
    render(<Terminal sessionId="s1" />, { wrapper });

    mockTermResize.mockClear();
    mockTermRefresh.mockClear();
    mockSend.mockClear();

    act(() => {
      roCallbacks[0]([] as ResizeObserverEntry[]);
      vi.advanceTimersByTime(100);
    });

    expect(mockTermResize).not.toHaveBeenCalled();
    expect(mockTermRefresh).toHaveBeenCalledWith(0, 23);
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "resize" }),
    );
    vi.useRealTimers();
  });

  it("registers terminal input handler", () => {
    render(<Terminal sessionId="s1" />, { wrapper });

    expect(mockTermOnData).toHaveBeenCalledTimes(1);
  });

  it("ignores OS file drops while the WebSocket is open but not attached", () => {
    mockSocketStatus.current = "open";
    const { container } = render(
      <Terminal sessionId="s-drop-open" projectId="p1" />,
      { wrapper },
    );
    const root = container.firstElementChild as HTMLElement | null;
    if (!root) throw new Error("missing terminal root");

    act(() => dispatchOsFileDrop(root));

    expect(mockUploadDrops).not.toHaveBeenCalled();
  });

  it("uploads OS file drops after the terminal is attached", async () => {
    mockUploadDrops.mockResolvedValue(["/tmp/uploaded file.txt"]);
    const { container } = render(
      <Terminal sessionId="s-drop-attached" projectId="p1" />,
      { wrapper },
    );
    const root = container.firstElementChild as HTMLElement | null;
    if (!root) throw new Error("missing terminal root");

    await act(async () => {
      dispatchOsFileDrop(root);
      await Promise.resolve();
    });

    expect(mockUploadDrops).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: "input",
      data: "'/tmp/uploaded file.txt'",
    });
    expect(mockTermFocus).toHaveBeenCalled();
  });

  it("ignores clipboard image paste while the WebSocket is open but not attached", () => {
    mockSocketStatus.current = "open";
    render(<Terminal sessionId="s-paste-open" projectId="p1" />, { wrapper });

    act(() => dispatchClipboardImagePaste());

    expect(mockUploadDrops).not.toHaveBeenCalled();
  });

  it("uploads bounded terminal diagnostics around terminal input without raw text", () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    enableTerminalTrace();
    render(<Terminal sessionId="s-input-diagnostic" />, { wrapper });
    mockSend.mockClear();

    const onData = mockTermOnData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined;
    if (!onData) throw new Error("missing onData handler");

    act(() => {
      onData("secret input");
      vi.advanceTimersByTime(250);
    });

    expect(mockSend).toHaveBeenCalledWith({
      type: "input",
      data: "secret input",
    });

    const diagnosticCalls = fetchMock.mock.calls.filter(
      ([url]) => url === "/api/debug/terminal-trace/client-diagnostic",
    );
    expect(diagnosticCalls).toHaveLength(3);
    const bodies = diagnosticCalls.map(([, init]) =>
      JSON.parse(String((init as RequestInit | undefined)?.body)),
    );
    expect(bodies.map((body) => body.reason)).toEqual([
      "terminal-input-sent",
      "terminal-input-after-80ms",
      "terminal-input-after-250ms",
    ]);
    expect(JSON.stringify(bodies)).not.toContain("secret input");
    expect(bodies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          diagnostic: "terminal-input-background",
          sessionId: "s-input-diagnostic",
          events: expect.arrayContaining([
            expect.objectContaining({
              type: "terminal-input-diagnostic",
              sessionId: "s-input-diagnostic",
              dataLength: 12,
              status: "raw",
              cols: 80,
              rows: 24,
              cursorX: 8,
              cursorY: 2,
              viewportY: 5,
              baseY: 5,
            }),
          ]),
        }),
      ]),
    );
    vi.useRealTimers();
  });

  it("suppresses duplicate text emitted during one IME composition commit", () => {
    render(<Terminal sessionId="s-ime" />, { wrapper });
    mockSend.mockClear();

    const onData = mockTermOnData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined;
    if (!onData) throw new Error("missing onData handler");
    const term = MockXTerm.mock.results[0]?.value as {
      textarea: {
        addEventListener: Mock;
      };
    };
    const compositionStart = term.textarea.addEventListener.mock.calls.find(
      ([type]) => type === "compositionstart",
    )?.[1] as ((event: Event) => void) | undefined;
    const compositionEnd = term.textarea.addEventListener.mock.calls.find(
      ([type]) => type === "compositionend",
    )?.[1] as ((event: Event) => void) | undefined;
    if (!compositionStart || !compositionEnd) {
      throw new Error("missing composition listeners");
    }

    act(() => {
      compositionStart(new Event("compositionstart"));
      onData("確定");
      compositionEnd(new Event("compositionend"));
      onData("確定");
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({ type: "input", data: "確定" });
  });

  it("does not suppress repeated text outside the IME duplicate window", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s-ime-window" />, { wrapper });
    mockSend.mockClear();

    const onData = mockTermOnData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined;
    if (!onData) throw new Error("missing onData handler");
    const term = MockXTerm.mock.results[0]?.value as {
      textarea: {
        addEventListener: Mock;
      };
    };
    const compositionStart = term.textarea.addEventListener.mock.calls.find(
      ([type]) => type === "compositionstart",
    )?.[1] as ((event: Event) => void) | undefined;
    const compositionEnd = term.textarea.addEventListener.mock.calls.find(
      ([type]) => type === "compositionend",
    )?.[1] as ((event: Event) => void) | undefined;
    if (!compositionStart || !compositionEnd) {
      throw new Error("missing composition listeners");
    }

    act(() => {
      compositionStart(new Event("compositionstart"));
      onData("あ");
      compositionEnd(new Event("compositionend"));
      vi.advanceTimersByTime(200);
      onData("あ");
    });

    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenNthCalledWith(1, { type: "input", data: "あ" });
    expect(mockSend).toHaveBeenNthCalledWith(2, { type: "input", data: "あ" });
  });

  it("records sanitized xterm, replay, and DOM trace events when enabled", async () => {
    enableTerminalTrace();
    render(<Terminal sessionId="s-trace" />, { wrapper });

    const onData = mockTermOnData.mock.calls[0]?.[0] as
      | ((data: string) => void)
      | undefined;
    if (!onData) throw new Error("missing onData handler");

    act(() => {
      onData("secret input");
      socketOptionsRef.onData?.("secret output");
      socketOptionsRef.onFullReplay?.(null);
      socketOptionsRef.onData?.("secret replay");
    });
    await flushAnimationFrame();

    const term = MockXTerm.mock.results[0]?.value as {
      textarea: {
        addEventListener: Mock;
      };
    };
    const compositionEnd = term.textarea.addEventListener.mock.calls.find(
      ([type]) => type === "compositionend",
    )?.[1] as ((event: Event) => void) | undefined;
    if (!compositionEnd) throw new Error("missing compositionend listener");
    act(() => {
      compositionEnd(
        new InputEvent("compositionend", {
          data: "確定",
          inputType: "insertCompositionText",
        }),
      );
    });

    const trace = window.parasorTerminalTrace?.dump() ?? [];
    expect(trace.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "terminal-mount",
        "xterm-open",
        "xterm-on-data",
        "terminal-send-input",
        "xterm-write-start",
        "xterm-replay-reset",
        "xterm-replay-write-start",
        "xterm-replay-write-callback",
        "xterm-replay-refresh",
        "xterm-replay-paint",
        "dom-compositionend",
      ]),
    );
    expect(JSON.stringify(trace)).not.toContain("secret input");
    expect(JSON.stringify(trace)).not.toContain("secret output");
    expect(JSON.stringify(trace)).not.toContain("secret replay");
    expect(JSON.stringify(trace)).not.toContain("確定");
    expect(trace.find((event) => event.type === "dom-compositionend")).toEqual(
      expect.objectContaining({
        sessionId: "s-trace",
        dataLength: 2,
        inputType: "insertCompositionText",
      }),
    );
  });

  it("registers the mounted terminal for local bottom-row diagnostics", () => {
    mockTermGetLine.mockImplementation((lineNumber: number) =>
      lineNumber === 27 ? makeTraceBufferLine("codx") : undefined,
    );

    const { unmount } = render(
      <Terminal sessionId="s-trace-dump" paneId="pane-trace-dump" />,
      {
        wrapper,
      },
    );

    const snapshot = window.parasorTerminalTrace?.dumpBottomRows(2);
    expect(snapshot).toMatchObject({
      cols: 80,
      rows: 24,
      cursorX: 8,
      cursorY: 2,
      viewportY: 5,
      baseY: 5,
      renderer: {
        requestedWebgl: true,
        effectiveRenderer: "webgl",
        webglStatus: "attached",
        contextLossCount: 0,
        fontLoadingDoneCount: 0,
        atlasRebuildCount: 0,
        iosFontPrefetchStatus: "not-ios",
        unicodeVersion: "11",
        isTouch: false,
        isIos: false,
      },
      rowCount: 2,
      rowsSampled: [
        { line: 27, viewportRow: 22, text: "codx" },
        { line: 28, viewportRow: 23, text: "" },
      ],
    });
    expect(
      window.parasorTerminalTrace?.dumpBottomRows({
        rowCount: 2,
        sessionId: "s-trace-dump",
        paneId: "pane-trace-dump",
      }),
    ).toMatchObject({
      rowCount: 2,
      rowsSampled: [
        { line: 27, viewportRow: 22, text: "codx" },
        { line: 28, viewportRow: 23, text: "" },
      ],
    });
    expect(
      window.parasorTerminalTrace?.dumpBottomRows({
        rowCount: 2,
        sessionId: "other-session",
      }),
    ).toBeNull();

    unmount();
    expect(window.parasorTerminalTrace?.dumpBottomRows()).toBeNull();
  });

  it("traces focused renderer lifecycle on mount", () => {
    enableTerminalTrace();

    render(<Terminal sessionId="s-renderer-trace" />, {
      wrapper,
    });

    expect(window.parasorTerminalTrace?.dump()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "terminal-renderer-webgl-attach",
          sessionId: "s-renderer-trace",
          requestedWebgl: true,
          effectiveRenderer: "webgl",
          webglStatus: "attached",
          unicodeVersion: "11",
          isTouch: false,
          isIos: false,
        }),
      ]),
    );
  });

  it("does not render the manual terminal input diagnostic capture button inside the terminal body", () => {
    const { queryByLabelText } = render(<Terminal sessionId="s-trace-dump" />, {
      wrapper,
    });

    expect(queryByLabelText("Capture terminal diagnostics")).toBeNull();
  });

  it("sends ESC+CR for Shift+Enter so chat TUIs see a newline instead of submit", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    mockSend.mockClear();

    expect(customKeyHandlerRef.handler).toBeDefined();
    const preventDefault = vi.fn();
    const result = customKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(result).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({ type: "input", data: "\x1b\r" });
  });

  it("lets a plain Enter keystroke fall through to xterm's default encoder", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    mockSend.mockClear();

    const preventDefault = vi.fn();
    const result = customKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: false,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(result).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "input" }),
    );
  });

  it("ignores Shift+Enter combined with another modifier so existing chords still work", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    mockSend.mockClear();

    const preventDefault = vi.fn();
    const result = customKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      ctrlKey: true,
      altKey: false,
      metaKey: false,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(result).toBe(true);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "input" }),
    );
  });

  it("suppresses Shift+Enter during IME composition without firing the shortcut (isComposing)", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    mockSend.mockClear();

    const preventDefault = vi.fn();
    const result = customKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      isComposing: true,
      preventDefault,
    } as unknown as KeyboardEvent);

    // return false blocks xterm's default Enter->CR path (CompositionHelper
    // would otherwise finalize composition and submit). preventDefault is
    // not called so the textarea/IME compositionend can still complete.
    expect(result).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "input" }),
    );
  });

  it("suppresses Shift+Enter during IME composition without firing the shortcut (legacy keyCode=229)", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    mockSend.mockClear();

    const preventDefault = vi.fn();
    const result = customKeyHandler()({
      type: "keydown",
      key: "Enter",
      shiftKey: true,
      ctrlKey: false,
      altKey: false,
      metaKey: false,
      keyCode: 229,
      preventDefault,
    } as unknown as KeyboardEvent);

    expect(result).toBe(false);
    expect(preventDefault).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "input" }),
    );
  });

  it("requests a one-shot refresh when no initial data arrives", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockSend).toHaveBeenCalledWith({ type: "refresh" });
    vi.useRealTimers();
  });

  it("keeps the one-shot refresh armed for control-only startup data", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });

    act(() => {
      socketOptionsRef.onData?.("\u001b]0;parasor\u0007\u001b[?25l");
      vi.advanceTimersByTime(500);
    });

    expect(mockSend).toHaveBeenCalledWith({ type: "refresh" });
    vi.useRealTimers();
  });

  it("cancels the one-shot refresh once visible output arrives", () => {
    vi.useFakeTimers();
    render(<Terminal sessionId="s1" />, { wrapper });

    act(() => {
      socketOptionsRef.onData?.("user@host:~$ ");
      vi.advanceTimersByTime(500);
    });

    expect(mockSend).not.toHaveBeenCalledWith({ type: "refresh" });
    vi.useRealTimers();
  });

  it("stops coordinate-less xterm gesture events only when mouse tracking is active", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    const xtermGestureHandler = vi.fn();
    screen.addEventListener("-xterm-gesturechange", xtermGestureHandler);

    // Tracking off -> coord-less inertia ticks pass through so xterm can
    // drive touch-scroll inertia in normal-buffer / non-mouse-tracking apps.
    mockModes.mouseTrackingMode = "none";
    const inertiaEventOff = new Event("-xterm-gesturechange", {
      cancelable: true,
    });
    const stopOff = vi.spyOn(inertiaEventOff, "stopImmediatePropagation");
    screen.dispatchEvent(inertiaEventOff);
    expect(stopOff).not.toHaveBeenCalled();
    expect(xtermGestureHandler).toHaveBeenCalledTimes(1);

    // Tracking on -> coord-less ticks would feed NaN into SGR pixel reports,
    // so they must be stopped before reaching the mouse handler.
    mockModes.mouseTrackingMode = "vt200";
    const inertiaEventOn = new Event("-xterm-gesturechange", {
      cancelable: true,
    });
    const stopOn = vi.spyOn(inertiaEventOn, "stopImmediatePropagation");
    screen.dispatchEvent(inertiaEventOn);
    expect(stopOn).toHaveBeenCalled();
    expect(xtermGestureHandler).toHaveBeenCalledTimes(1);

    // Events with finite coords always pass through regardless of mode.
    const touchMoveEvent = new Event("-xterm-gesturechange", {
      cancelable: true,
    });
    Object.defineProperties(touchMoveEvent, {
      clientX: { value: 12 },
      clientY: { value: 24 },
    });
    screen.dispatchEvent(touchMoveEvent);
    expect(xtermGestureHandler).toHaveBeenCalledTimes(2);
  });

  it("selects terminal text with a long-press drag on touch devices", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    Object.defineProperty(screen, "getBoundingClientRect", {
      value: () => ({
        left: 0,
        top: 0,
        width: 800,
        height: 240,
        right: 800,
        bottom: 240,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }),
    });
    const xtermTouchMoveHandler = vi.fn();
    screen.addEventListener("touchmove", xtermTouchMoveHandler);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 10 },
        ]),
      );
      vi.advanceTimersByTime(451);
    });

    expect(mockTermSelect).toHaveBeenLastCalledWith(8, 6, 1);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchmove", [
          { identifier: 1, clientX: 120, clientY: 15 },
        ]),
      );
    });

    expect(mockTermSelect).toHaveBeenLastCalledWith(8, 6, 5);
    expect(xtermTouchMoveHandler).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows a floating copy-only toolbar after long-press terminal selection", async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    mockTermGetSelection.mockReturnValue("copy me");
    mockTermGetSelectionPosition.mockReturnValue({
      start: { x: 8, y: 7 },
      end: { x: 16, y: 7 },
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 10 },
        ]),
      );
      vi.advanceTimersByTime(451);
      screen.dispatchEvent(
        makeTouchEvent("touchend", [
          { identifier: 1, clientX: 120, clientY: 40 },
        ]),
      );
    });

    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();
    expect(buttonByLabel(container, "Adjust selection start")).not.toBeNull();
    expect(buttonByLabel(container, "Adjust selection end")).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Paste into terminal"]'),
    ).toBeNull();

    const rootPointerDown = vi.fn();
    container.addEventListener("pointerdown", rootPointerDown);
    const copyButton = buttonByLabel(container, "Copy terminal selection");
    const pointerDown = makePointerEvent("pointerdown", {
      clientX: 120,
      clientY: 20,
    });
    act(() => {
      copyButton.dispatchEvent(pointerDown);
    });
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(rootPointerDown).not.toHaveBeenCalled();

    mockTermFocus.mockClear();
    await act(async () => {
      copyButton.click();
    });

    expect(writeText).toHaveBeenCalledWith("copy me");
    expect(mockTermFocus).not.toHaveBeenCalled();
    expect(localStorage.getItem(TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY)).toBe(
      "copy me",
    );
    expect(mockTermClearSelection).toHaveBeenCalled();
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).toBeNull();

    const xtermMouseDownHandler = vi.fn();
    screen.addEventListener("mousedown", xtermMouseDownHandler);
    const syntheticMouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      screen.dispatchEvent(syntheticMouseDown);
    });
    expect(syntheticMouseDown.defaultPrevented).toBe(true);
    expect(xtermMouseDownHandler).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(701);
    });
    const laterMouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
    });
    act(() => {
      screen.dispatchEvent(laterMouseDown);
    });
    expect(laterMouseDown.defaultPrevented).toBe(false);
    expect(xtermMouseDownHandler).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("hides the selection toolbar while dragging range handles and restores it on release", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mockTermGetSelection.mockReturnValue("copy me");
    mockTermGetSelectionPosition.mockReturnValue({
      start: { x: 8, y: 7 },
      end: { x: 12, y: 7 },
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 10 },
        ]),
      );
      vi.advanceTimersByTime(451);
      screen.dispatchEvent(
        makeTouchEvent("touchend", [
          { identifier: 1, clientX: 120, clientY: 10 },
        ]),
      );
    });

    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();

    const endHandle = buttonByLabel(container, "Adjust selection end");
    act(() => {
      endHandle.dispatchEvent(
        makePointerEvent("pointerdown", { clientX: 120, clientY: 30 }),
      );
    });

    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).toBeNull();

    act(() => {
      window.dispatchEvent(
        makePointerEvent("pointermove", { clientX: 160, clientY: 34 }),
      );
    });

    expect(mockTermSelect).toHaveBeenLastCalledWith(8, 7, 8);
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).toBeNull();

    act(() => {
      window.dispatchEvent(
        makePointerEvent("pointerup", { clientX: 160, clientY: 34 }),
      );
    });

    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();
    vi.useRealTimers();
  });

  it("shows a paste-only toolbar after long-pressing the terminal input row", async () => {
    vi.useFakeTimers();
    enableTerminalTrace();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const readText = vi.fn().mockResolvedValue("pasted input");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);
    mockTermSelect.mockClear();

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      vi.advanceTimersByTime(451);
    });

    expect(mockTermSelect).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Copy terminal selection"]'),
    ).toBeNull();

    await act(async () => {
      const pasteButton = buttonByLabel(container, "Paste into terminal");
      pasteButton.dispatchEvent(makeToolbarTouchEndEvent(120, 20));
      pasteButton.dispatchEvent(
        makePointerEvent("pointerup", { clientX: 120, clientY: 20 }),
      );
      pasteButton.click();
    });

    expect(readText).toHaveBeenCalledTimes(1);
    expect(window.parasorTerminalTrace?.dump()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "terminal-toolbar-action",
          surface: "paste",
          status: "touchend",
          skipped: false,
        }),
        expect.objectContaining({
          type: "terminal-toolbar-action",
          surface: "paste",
          status: "pointerup",
          skipped: true,
        }),
      ]),
    );
    expect(mockSend).toHaveBeenCalledWith({
      type: "input",
      data: "pasted input",
    });
    expect(mockTermFocus).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("shows a paste-only toolbar after tapping the terminal input row", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const readText = vi.fn().mockResolvedValue("tap paste");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEndEvent([{ identifier: 1, clientX: 80, clientY: 20 }]),
      );
    });

    expect(mockTermFocus).toHaveBeenCalledTimes(1);
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Copy terminal selection"]'),
    ).toBeNull();

    await act(async () => {
      buttonByLabel(container, "Paste into terminal").click();
    });

    expect(readText).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledWith({
      type: "input",
      data: "tap paste",
    });
  });

  it("falls back to the internal terminal clipboard when native clipboard read fails", async () => {
    vi.useFakeTimers();
    enableTerminalTrace();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const readText = vi
      .fn()
      .mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText },
    });
    localStorage.setItem(
      TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY,
      "internal paste",
    );
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      vi.advanceTimersByTime(451);
    });

    await act(async () => {
      buttonByLabel(container, "Paste into terminal").click();
    });

    expect(readText).toHaveBeenCalled();
    expect(mockSend).toHaveBeenCalledWith({
      type: "input",
      data: "internal paste",
    });
    expect(mockTermFocus).not.toHaveBeenCalled();
    expect(window.parasorTerminalTrace?.dump()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "terminal-toolbar-paste-failed",
          status: "native",
          reason: "NotAllowedError",
        }),
        expect.objectContaining({
          type: "terminal-toolbar-paste",
          status: "internal",
          dataLength: 14,
        }),
      ]),
    );
    vi.useRealTimers();
  });

  it("does not show the input paste toolbar when no paste route is available", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      vi.advanceTimersByTime(451);
    });

    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "input", data: expect.any(String) }),
    );
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).toBeNull();
    vi.useRealTimers();
  });

  it("does not show the selection toolbar while mouse tracking is active", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mockModes.mouseTrackingMode = "vt200";
    mockTermGetSelection.mockReturnValue("copy me");
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      vi.advanceTimersByTime(451);
      screen.dispatchEvent(
        makeTouchEvent("touchend", [
          { identifier: 1, clientX: 120, clientY: 40 },
        ]),
      );
    });

    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).toBeNull();
    vi.useRealTimers();
  });

  it("keeps an existing word selection when long-pressing inside it", () => {
    vi.useFakeTimers();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    mockTermHasSelection.mockReturnValue(true);
    mockTermGetSelection.mockReturnValue("copy me");
    mockTermGetSelectionPosition.mockReturnValue({
      start: { x: 5, y: 7 },
      end: { x: 12, y: 7 },
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);
    mockTermSelect.mockClear();
    mockTermClearSelection.mockClear();

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      vi.advanceTimersByTime(451);
    });

    expect(mockTermClearSelection).not.toHaveBeenCalled();
    expect(mockTermSelect).not.toHaveBeenCalled();
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();
    vi.useRealTimers();
  });

  it("clears an existing selection on a plain tap outside the selection", async () => {
    mockTermHasSelection.mockReturnValue(true);
    mockTermGetSelection.mockReturnValue("copy me");
    mockTermGetSelectionPosition.mockReturnValue({
      start: { x: 5, y: 7 },
      end: { x: 12, y: 7 },
    });
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);
    mockTermRefresh.mockClear();

    plainTapOnScreen(screen, 80, 0);

    expect(mockTermClearSelection).toHaveBeenCalledTimes(1);
    expect(mockTermRefresh).not.toHaveBeenCalled();
    await flushAnimationFrame();
    expect(mockTermRefresh).toHaveBeenCalledWith(0, 23);
    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("keeps an existing selection on a plain tap inside the selection", () => {
    mockTermHasSelection.mockReturnValue(true);
    mockTermGetSelection.mockReturnValue("copy me");
    mockTermGetSelectionPosition.mockReturnValue({
      start: { x: 5, y: 7 },
      end: { x: 12, y: 7 },
    });
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    plainTapOnScreen(screen, 80, 20);

    expect(mockTermClearSelection).not.toHaveBeenCalled();
  });

  it("clears an existing selection before showing input-row paste actions", async () => {
    mockTermHasSelection.mockReturnValue(true);
    mockTermGetSelection.mockReturnValue("copy me");
    mockTermGetSelectionPosition.mockReturnValue({
      start: { x: 5, y: 5 },
      end: { x: 12, y: 5 },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: vi.fn().mockResolvedValue("paste") },
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);
    mockTermRefresh.mockClear();

    plainTapOnScreen(screen, 80, 20);

    expect(mockTermClearSelection).toHaveBeenCalledTimes(1);
    expect(mockTermRefresh).not.toHaveBeenCalled();
    await flushAnimationFrame();
    expect(mockTermRefresh).toHaveBeenCalledWith(0, 23);
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();
    expect(
      container.querySelector('button[aria-label="Copy terminal selection"]'),
    ).toBeNull();
  });

  it("does not stop ordinary touchmove before long-press selection activates", () => {
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);
    const xtermTouchMoveHandler = vi.fn();
    screen.addEventListener("touchmove", xtermTouchMoveHandler);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEvent("touchmove", [
          { identifier: 1, clientX: 80, clientY: 80 },
        ]),
      );
    });

    expect(xtermTouchMoveHandler).toHaveBeenCalledTimes(1);
  });

  it("adds non-passive selection drag listeners only after long press", () => {
    vi.useFakeTimers();
    const addSpy = vi.spyOn(HTMLElement.prototype, "addEventListener");
    try {
      render(<Terminal sessionId="s1" />, { wrapper });
      const screen = must(document.querySelector(".xterm-screen"));
      mockScreenRect(screen);

      const initialTouchCalls = addSpy.mock.calls.filter(
        (call, index) =>
          addSpy.mock.contexts[index] === screen &&
          ["touchmove", "touchend", "touchcancel"].includes(call[0] as string),
      );
      expect(
        initialTouchCalls.some(
          (call) => (call[2] as AddEventListenerOptions).passive === true,
        ),
      ).toBe(true);
      expect(
        initialTouchCalls.some(
          (call) => (call[2] as AddEventListenerOptions).passive === false,
        ),
      ).toBe(false);

      act(() => {
        screen.dispatchEvent(
          makeTouchEvent("touchstart", [
            { identifier: 1, clientX: 80, clientY: 10 },
          ]),
        );
        vi.advanceTimersByTime(451);
      });

      const activeTouchMoveCalls = addSpy.mock.calls.filter(
        (call, index) =>
          addSpy.mock.contexts[index] === screen && call[0] === "touchmove",
      );
      expect(
        activeTouchMoveCalls.some(
          (call) => (call[2] as AddEventListenerOptions).passive === false,
        ),
      ).toBe(true);
    } finally {
      addSpy.mockRestore();
      vi.useRealTimers();
    }
  });

  it("focuses xterm on a single tap in the terminal input row", () => {
    mockModes.showCursor = true;
    mockModes.mouseTrackingMode = "none";
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEndEvent([{ identifier: 1, clientX: 80, clientY: 20 }]),
      );
    });

    expect(mockTermFocus).toHaveBeenCalledTimes(1);
  });

  it("does not focus xterm on a single tap in terminal output text", () => {
    mockModes.showCursor = true;
    mockModes.mouseTrackingMode = "none";
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 0 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEndEvent([{ identifier: 1, clientX: 80, clientY: 0 }]),
      );
    });

    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("selects a Japanese word on double-tap through wide xterm cells", () => {
    mockTermGetLine.mockReturnValue(
      makeBufferLine([
        { chars: "日", width: 2 },
        { chars: "", width: 0 },
        { chars: "本", width: 2 },
        { chars: "", width: 0 },
        { chars: "語", width: 2 },
        { chars: "", width: 0 },
        { chars: "入", width: 2 },
        { chars: "", width: 0 },
        { chars: "力", width: 2 },
        { chars: "", width: 0 },
        { chars: "で", width: 2 },
        { chars: "", width: 0 },
        { chars: "す", width: 2 },
        { chars: "", width: 0 },
      ]),
    );
    mockTermGetSelection.mockReturnValue("入力");
    mockTermGetSelectionPosition.mockReturnValue({
      start: { x: 6, y: 5 },
      end: { x: 10, y: 5 },
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    plainTapOnScreen(screen, 75, 5);
    plainTapOnScreen(screen, 75, 5);

    expect(mockTermSelect).toHaveBeenCalledWith(6, 5, 4);
    expect(
      container.querySelector(
        '[role="toolbar"][aria-label="Terminal selection actions"]',
      ),
    ).not.toBeNull();
    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("skips focus on tap when the TUI hides the cursor and is not tracking mouse", () => {
    mockModes.showCursor = false;
    mockModes.mouseTrackingMode = "none";
    render(<Terminal sessionId="s1" />, { wrapper });

    const container = mockTermOpen.mock.calls[0]?.[0] as HTMLElement;
    act(() => {
      container.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      container.dispatchEvent(makeTouchEvent("touchend", []));
    });

    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("focuses xterm on tap when the TUI is capturing mouse events", () => {
    mockModes.showCursor = false;
    mockModes.mouseTrackingMode = "vt200";
    render(<Terminal sessionId="s1" />, { wrapper });

    const container = mockTermOpen.mock.calls[0]?.[0] as HTMLElement;
    act(() => {
      container.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      container.dispatchEvent(makeTouchEvent("touchend", []));
    });

    expect(mockTermFocus).toHaveBeenCalledTimes(1);
  });

  it("does not focus xterm when a touch scrolls past the slop threshold", () => {
    mockModes.showCursor = true;
    mockModes.mouseTrackingMode = "none";
    render(<Terminal sessionId="s1" />, { wrapper });

    const container = mockTermOpen.mock.calls[0]?.[0] as HTMLElement;
    act(() => {
      container.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      container.dispatchEvent(
        makeTouchEvent("touchmove", [
          { identifier: 1, clientX: 80, clientY: 120 },
        ]),
      );
      container.dispatchEvent(makeTouchEvent("touchend", []));
    });

    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("does not focus xterm when an output tap moves within the slop threshold", () => {
    mockModes.showCursor = true;
    mockModes.mouseTrackingMode = "none";
    render(<Terminal sessionId="s1" />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 0 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEvent("touchmove", [
          { identifier: 1, clientX: 83, clientY: 4 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEndEvent([{ identifier: 1, clientX: 83, clientY: 4 }]),
      );
    });

    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("does not focus xterm on a multi-touch (pinch) gesture", () => {
    mockModes.showCursor = true;
    mockModes.mouseTrackingMode = "none";
    render(<Terminal sessionId="s1" />, { wrapper });

    const container = mockTermOpen.mock.calls[0]?.[0] as HTMLElement;
    act(() => {
      container.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
        ]),
      );
      container.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 80, clientY: 20 },
          { identifier: 2, clientX: 160, clientY: 40 },
        ]),
      );
      container.dispatchEvent(makeTouchEvent("touchend", []));
    });

    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("opens a tapped non-loopback URL in a new tab and suppresses the synthetic tap", () => {
    vi.useFakeTimers();
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("see https://example.com here")),
    );
    render(<Terminal sessionId="s1" onOpenUrl={onOpenUrl} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    // clientX 105 ⇒ cell column 10, inside "https://example.com" (cols 4--22).
    const endEvent = plainTapOnScreen(screen, 105, 5);

    expect(mockTermSelect).toHaveBeenCalledWith(4, 5, 19);
    expect(mockOpenHttpUrlInNewTab).toHaveBeenCalledWith("https://example.com");
    expect(onOpenUrl).not.toHaveBeenCalled();
    // touchend is passive for scroll performance; the component suppresses
    // the follow-up synthetic click instead so the link is not re-opened and
    // the soft keyboard is not raised.
    expect(endEvent.defaultPrevented).toBe(false);
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      screen.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(true);
    expect(mockTermFocus).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(651));
    expect(mockTermClearSelection).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("routes a tapped loopback dev-server URL through onOpenUrl, not a raw new tab", () => {
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("run http://localhost:5173 ok")),
    );
    render(<Terminal sessionId="s1" projectId="p1" onOpenUrl={onOpenUrl} />, {
      wrapper,
    });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    // clientX 105 ⇒ cell column 10, inside "http://localhost:5173" (cols 4--24).
    plainTapOnScreen(screen, 105, 5);

    expect(mockTermSelect).toHaveBeenCalledWith(4, 5, 21);
    expect(onOpenUrl).toHaveBeenCalledWith("http://localhost:5173", {
      projectId: "p1",
    });
    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
  });

  it("routes tapped IPv6 loopback and wildcard URLs through onOpenUrl for reachable host resolution", () => {
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("run http://[::1]:5173 ok")),
    );
    render(<Terminal sessionId="s1" onOpenUrl={onOpenUrl} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    plainTapOnScreen(screen, 105, 5);

    expect(onOpenUrl).toHaveBeenCalledWith("http://[::1]:5173");
    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
  });

  it("opens file path links through the terminal file callback", () => {
    const onOpenFilePath = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("see packages/web/src/App.tsx:12")),
    );
    render(
      <Terminal
        sessionId="s1"
        worktreePath="/repo"
        onOpenFilePath={onOpenFilePath}
      />,
      { wrapper },
    );

    const provider = must(registeredLinkProviders[0]);
    let links: unknown[] | undefined;
    provider.provideLinks(6, (provided) => {
      links = provided;
    });
    const link = must(links?.[0]) as {
      range: { start: { x: number; y: number }; end: { x: number; y: number } };
      activate: () => void;
      text: string;
    };

    expect(link.text).toBe("packages/web/src/App.tsx:12");
    expect(link.range).toEqual({
      start: { x: 5, y: 6 },
      end: { x: 31, y: 6 },
    });
    link.activate();
    expect(onOpenFilePath).toHaveBeenCalledWith("packages/web/src/App.tsx");
  });

  it("opens tapped file paths in the terminal on touch devices", () => {
    const onOpenFilePath = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("see packages/web/src/App.tsx:12")),
    );
    render(
      <Terminal
        sessionId="s1"
        worktreePath="/repo"
        onOpenFilePath={onOpenFilePath}
      />,
      { wrapper },
    );
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    plainTapOnScreen(screen, 105, 5);

    expect(mockTermSelect).toHaveBeenCalledWith(4, 5, 27);
    expect(onOpenFilePath).toHaveBeenCalledWith("packages/web/src/App.tsx");
    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
  });

  it("maps the tapped cell through wide CJK glyphs before matching the URL", () => {
    mockTermGetLine.mockReturnValue(
      makeBufferLine([
        { chars: "あ", width: 2 },
        { chars: "", width: 0 },
        { chars: "い", width: 2 },
        { chars: "", width: 0 },
        ...cellsFromText(" https://example.com"),
      ]),
    );
    render(<Terminal sessionId="s1" onOpenUrl={vi.fn()} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    // Cell column 23 = the final "m" of the URL. A naive `string[col]` lookup
    // would land two cells past the row's logical string (each CJK glyph spans
    // two cells but contributes one char) and miss the link entirely.
    plainTapOnScreen(screen, 235, 5);

    expect(mockTermSelect).toHaveBeenCalledWith(5, 5, 19);
    expect(mockOpenHttpUrlInNewTab).toHaveBeenCalledWith("https://example.com");
  });

  it("does not suppress a tap on a regex-shaped but invalid URL", () => {
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("bad https://?x here")),
    );
    render(<Terminal sessionId="s1" onOpenUrl={onOpenUrl} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    const endEvent = plainTapOnScreen(screen, 75, 5); // inside "https://?x"

    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(mockTermSelect).not.toHaveBeenCalled();
    expect(endEvent.defaultPrevented).toBe(false);
  });

  it("does not open anything when a plain tap misses every URL on the row", () => {
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("plain text, no link on this row")),
    );
    render(<Terminal sessionId="s1" onOpenUrl={onOpenUrl} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    const endEvent = plainTapOnScreen(screen, 25, 5); // cell column 2 -- "plain"

    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(endEvent.defaultPrevented).toBe(false);
  });

  it("does not open a URL on long-press (text selection wins)", () => {
    vi.useFakeTimers();
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("see https://example.com here")),
    );
    render(<Terminal sessionId="s1" onOpenUrl={onOpenUrl} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 105, clientY: 5 },
        ]),
      );
      vi.advanceTimersByTime(451);
      screen.dispatchEvent(
        makeTouchEvent("touchend", [
          { identifier: 1, clientX: 105, clientY: 5 },
        ]),
      );
    });

    expect(mockTermSelect).toHaveBeenCalled();
    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("does not open a URL when the gesture drags past the selection slop", () => {
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("see https://example.com here")),
    );
    render(<Terminal sessionId="s1" onOpenUrl={onOpenUrl} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    act(() => {
      screen.dispatchEvent(
        makeTouchEvent("touchstart", [
          { identifier: 1, clientX: 105, clientY: 5 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEvent("touchmove", [
          { identifier: 1, clientX: 105, clientY: 60 },
        ]),
      );
      screen.dispatchEvent(
        makeTouchEvent("touchend", [
          { identifier: 1, clientX: 105, clientY: 60 },
        ]),
      );
    });

    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
  });

  it("ignores URL taps while a mouse-tracking app owns the screen", () => {
    mockModes.mouseTrackingMode = "vt200";
    const onOpenUrl = vi.fn();
    mockTermGetLine.mockReturnValue(
      makeBufferLine(cellsFromText("see https://example.com here")),
    );
    render(<Terminal sessionId="s1" onOpenUrl={onOpenUrl} />, { wrapper });
    const screen = must(document.querySelector(".xterm-screen"));
    mockScreenRect(screen);

    const endEvent = plainTapOnScreen(screen, 105, 5);

    expect(mockOpenHttpUrlInNewTab).not.toHaveBeenCalled();
    expect(onOpenUrl).not.toHaveBeenCalled();
    expect(endEvent.defaultPrevented).toBe(false);
  });

  it("opens the bottom sheet via the + button on the key bar", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    const { container } = render(<Terminal sessionId="s1" />, { wrapper });

    const more = buttonByLabel(container, "More actions");
    expect(more.getAttribute("aria-expanded")).toBe("false");
    act(() => {
      more.click();
    });
    expect(more.getAttribute("aria-expanded")).toBe("true");
    // Sheet is rendered into document.body via portal.
    const sheet = document.querySelector(
      '[role="dialog"][aria-label="Mobile actions"]',
    );
    expect(sheet).not.toBeNull();
  });

  it("dismisses the keyboard via the keyboard toggle on the bar", async () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    let listener: (() => void) | null = null;
    const vv = {
      height: 400,
      offsetTop: 0,
      addEventListener: (_type: string, cb: () => void) => {
        listener = cb;
      },
      removeEventListener: vi.fn(),
    };
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: vv,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    const { container } = render(<Terminal sessionId="s1" />, { wrapper });

    // Force useVirtualKeyboard to pick up the occlusion (kbHeight = 400).
    act(() => {
      listener?.();
    });
    await flushAnimationFrame();

    mockTermFocus.mockClear();
    const hide = buttonByLabel(container, "Hide keyboard");
    act(() => {
      hide.click();
    });
    expect(mockTermTextareaBlur).toHaveBeenCalledTimes(1);
    expect(mockTermFocus).not.toHaveBeenCalled();
  });

  it("cleans up on unmount", () => {
    const { unmount } = render(<Terminal sessionId="s1" />, { wrapper });
    unmount();

    expect(mockTermDispose).toHaveBeenCalled();
    for (const inst of roInstances) {
      expect(inst.disconnect).toHaveBeenCalled();
    }
  });

  describe("init frame timing (race with fitAddon)", () => {
    it("delays sendInit when proposeDimensions returns undefined at mount", () => {
      mockFitAddonProposeDimensions.mockReturnValue(undefined);
      render(<Terminal sessionId="s1" />, { wrapper });

      expect(mockSendInit).not.toHaveBeenCalled();
    });

    it("registers onData eagerly so pre-init keystrokes are queued, not dropped", () => {
      // Deferred init: proposeDimensions returns nothing, so commitInit
      // does not run on mount. onData must still be wired up -- the socket
      // hook queues input frames until sendInit lands, but only if the
      // keystrokes actually reach its send() call.
      mockFitAddonProposeDimensions.mockReturnValue(undefined);
      render(<Terminal sessionId="s1" />, { wrapper });

      expect(mockTermOnData).toHaveBeenCalledTimes(1);
      expect(mockSendInit).not.toHaveBeenCalled();

      // Simulate a pre-init keystroke. The handler must forward it to
      // send(); the hook's queue behaviour is covered by its own tests.
      const onDataHandler = mockTermOnData.mock.calls[0]?.[0] as (
        data: string,
      ) => void;
      act(() => {
        onDataHandler("a");
      });
      expect(mockSend).toHaveBeenCalledWith({ type: "input", data: "a" });
    });

    it("treats zero-dim proposeDimensions as invalid", () => {
      mockFitAddonProposeDimensions.mockReturnValue({ cols: 0, rows: 0 });
      render(<Terminal sessionId="s1" />, { wrapper });

      expect(mockSendInit).not.toHaveBeenCalled();
    });

    it("rejects FitAddon MINIMUM clamp {cols:2, rows:1} (zero-area container)", () => {
      // xterm-addon-fit clamps to MINIMUM_COLS=2 / MINIMUM_ROWS=1 even
      // when the container has no layout, so the previous `cols > 0`
      // gate used to accept the clamp and spawn a 2x1 PTY. Reject it.
      mockFitAddonProposeDimensions.mockReturnValue({ cols: 2, rows: 1 });
      render(<Terminal sessionId="s1" />, { wrapper });

      expect(mockSendInit).not.toHaveBeenCalled();
    });

    it("delays sendInit when containerRef has zero clientWidth", () => {
      vi.useFakeTimers();
      mockFitAddonProposeDimensions.mockReturnValue({ cols: 100, rows: 30 });
      render(<Terminal sessionId="s1" />, { wrapper });

      // term.open receives the containerRef div -- flip its clientWidth to
      // 0 on that specific instance, overriding the prototype default.
      const container = mockTermOpen.mock.calls[0]?.[0] as HTMLElement;
      Object.defineProperty(container, "clientWidth", {
        configurable: true,
        value: 0,
      });

      // First-pass check: rerun the guard via ResizeObserver path.
      mockSendInit.mockClear();
      act(() => {
        roCallbacks[0]?.([] as ResizeObserverEntry[]);
        vi.advanceTimersByTime(100);
      });
      expect(mockSendInit).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("rejects applyResize when proposeDimensions returns NaN", () => {
      vi.useFakeTimers();
      render(<Terminal sessionId="s1" />, { wrapper });

      mockTermResize.mockClear();
      mockSend.mockClear();
      mockFitAddonProposeDimensions.mockReturnValue({
        cols: Number.NaN,
        rows: Number.NaN,
      });
      act(() => {
        roCallbacks[0]?.([] as ResizeObserverEntry[]);
        vi.advanceTimersByTime(100);
      });

      expect(mockTermResize).not.toHaveBeenCalled();
      expect(mockSend).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "resize" }),
      );
      vi.useRealTimers();
    });

    it("copies and pastes through the internal terminal clipboard when native clipboard is unavailable", async () => {
      vi.useFakeTimers();
      enableTerminalTrace();
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: vi.fn().mockReturnValue({ matches: true }),
      });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: undefined,
      });
      mockTermGetSelection.mockReturnValue("copy me");
      mockTermGetSelectionPosition.mockReturnValue({
        start: { x: 8, y: 7 },
        end: { x: 16, y: 7 },
      });
      const { container } = render(<Terminal sessionId="s1" />, { wrapper });
      const screen = must(document.querySelector(".xterm-screen"));
      mockScreenRect(screen);

      act(() => {
        screen.dispatchEvent(
          makeTouchEvent("touchstart", [
            { identifier: 1, clientX: 80, clientY: 10 },
          ]),
        );
        vi.advanceTimersByTime(451);
        screen.dispatchEvent(
          makeTouchEvent("touchend", [
            { identifier: 1, clientX: 120, clientY: 40 },
          ]),
        );
      });

      await act(async () => {
        buttonByLabel(container, "Copy terminal selection").click();
      });

      expect(
        localStorage.getItem(TERMINAL_INTERNAL_CLIPBOARD_STORAGE_KEY),
      ).toBe("copy me");
      expect(window.parasorTerminalTrace?.dump()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "terminal-toolbar-copy",
            status: "internal",
            dataLength: 7,
          }),
          expect.objectContaining({
            type: "terminal-toolbar-copy-failed",
            status: "native",
            reason: "clipboard-api-unavailable",
          }),
        ]),
      );

      act(() => {
        screen.dispatchEvent(
          makeTouchEvent("touchstart", [
            { identifier: 1, clientX: 80, clientY: 20 },
          ]),
        );
        vi.advanceTimersByTime(451);
      });

      await act(async () => {
        buttonByLabel(container, "Paste into terminal").click();
      });

      expect(mockSend).toHaveBeenCalledWith({
        type: "input",
        data: "copy me",
      });
      expect(window.parasorTerminalTrace?.dump()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "terminal-toolbar-paste-failed",
            status: "native",
            reason: "clipboard-api-unavailable",
          }),
          expect.objectContaining({
            type: "terminal-toolbar-paste",
            status: "internal",
            dataLength: 7,
          }),
        ]),
      );
      vi.useRealTimers();
    });

    it("commits init once dimensions become valid via ResizeObserver", () => {
      vi.useFakeTimers();
      mockFitAddonProposeDimensions.mockReturnValue(undefined);
      render(<Terminal sessionId="s1" />, { wrapper });

      expect(mockSendInit).not.toHaveBeenCalled();

      mockFitAddonProposeDimensions.mockReturnValue({ cols: 120, rows: 40 });
      act(() => {
        roCallbacks[0]?.([] as ResizeObserverEntry[]);
        vi.advanceTimersByTime(100);
      });

      expect(mockSendInit).toHaveBeenCalledWith(80, 24);
      expect(mockTermOnData).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("falls back to firing init after 500ms when dimensions never settle", () => {
      vi.useFakeTimers();
      mockFitAddonProposeDimensions.mockReturnValue(undefined);
      render(<Terminal sessionId="s1" />, { wrapper });

      expect(mockSendInit).not.toHaveBeenCalled();

      act(() => {
        vi.advanceTimersByTime(500);
      });

      expect(mockSendInit).toHaveBeenCalledWith(80, 24);
      expect(mockTermOnData).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("does not double-commit if ResizeObserver fires before the fallback", () => {
      vi.useFakeTimers();
      mockFitAddonProposeDimensions.mockReturnValue(undefined);
      render(<Terminal sessionId="s1" />, { wrapper });

      mockFitAddonProposeDimensions.mockReturnValue({ cols: 120, rows: 40 });
      act(() => {
        roCallbacks[0]?.([] as ResizeObserverEntry[]);
        vi.advanceTimersByTime(100);
      });
      expect(mockSendInit).toHaveBeenCalledTimes(1);

      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(mockSendInit).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it("clears the fallback init timer on unmount", () => {
      vi.useFakeTimers();
      mockFitAddonProposeDimensions.mockReturnValue(undefined);
      const { unmount } = render(<Terminal sessionId="s1" />, { wrapper });

      unmount();
      act(() => {
        vi.advanceTimersByTime(1000);
      });

      expect(mockSendInit).not.toHaveBeenCalled();
      vi.useRealTimers();
    });

    it("does not queue an unchanged resize while commitInit is deferred", () => {
      vi.useFakeTimers();
      mockFitAddonProposeDimensions.mockReturnValue(undefined);
      render(<Terminal sessionId="s1" />, { wrapper });

      // commitInit must still be deferred (no valid dims).
      expect(mockSendInit).not.toHaveBeenCalled();

      const sentTypes = mockSend.mock.calls.map(
        (c) => (c[0] as { type: string }).type,
      );
      expect(sentTypes).not.toContain("resize");

      vi.useRealTimers();
    });
  });
});
