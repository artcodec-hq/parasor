import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { traceTerminalEvent } from "../../../lib/terminal-trace.js";
import { attachTerminalToolbarDismissLifecycle } from "./terminal-toolbar-dismiss-lifecycle.js";

vi.mock("../../../lib/terminal-trace.js", () => ({
  traceTerminalEvent: vi.fn(),
}));

const mockTraceTerminalEvent = vi.mocked(traceTerminalEvent);

describe("attachTerminalToolbarDismissLifecycle", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    mockTraceTerminalEvent.mockReset();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("dismisses an open toolbar when a document event lands outside it", () => {
    const inputToolbarAnchorRef = { current: { clientX: 10, clientY: 20 } };
    const inputToolbarDismissSuppressUntilRef = { current: 0 };
    const setInputToolbarAnchor = vi.fn();
    const cleanup = attachTerminalToolbarDismissLifecycle({
      sessionId: "s1",
      inputToolbarAnchorRef,
      inputToolbarDismissSuppressUntilRef,
      setInputToolbarAnchor,
    });

    document.body.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );

    expect(setInputToolbarAnchor).toHaveBeenCalledWith(null);
    expect(inputToolbarDismissSuppressUntilRef.current).toBeGreaterThan(0);
    expect(mockTraceTerminalEvent).toHaveBeenCalledWith(
      "terminal-toolbar-dismiss",
      {
        sessionId: "s1",
        surface: "paste",
        status: "pointerdown",
      },
    );
    cleanup();
  });

  it("keeps the toolbar open when the event lands inside it", () => {
    const toolbar = document.createElement("div");
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "Terminal selection actions");
    const button = document.createElement("button");
    toolbar.append(button);
    document.body.append(toolbar);
    const inputToolbarAnchorRef = { current: { clientX: 10, clientY: 20 } };
    const inputToolbarDismissSuppressUntilRef = { current: 0 };
    const setInputToolbarAnchor = vi.fn();
    const cleanup = attachTerminalToolbarDismissLifecycle({
      sessionId: "s1",
      inputToolbarAnchorRef,
      inputToolbarDismissSuppressUntilRef,
      setInputToolbarAnchor,
    });

    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(setInputToolbarAnchor).not.toHaveBeenCalled();
    expect(inputToolbarDismissSuppressUntilRef.current).toBe(0);
    expect(mockTraceTerminalEvent).not.toHaveBeenCalled();
    cleanup();
  });
});
