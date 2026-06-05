import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSidebarSearch } from "./useSidebarSearch.js";

function dispatchCmdK(
  options: {
    meta?: boolean;
    ctrl?: boolean;
    alt?: boolean;
    shift?: boolean;
  } = {
    meta: true,
  },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "k",
    metaKey: options.meta ?? false,
    ctrlKey: options.ctrl ?? false,
    altKey: options.alt ?? false,
    shiftKey: options.shift ?? false,
    cancelable: true,
  });
  window.dispatchEvent(event);
  return event;
}

describe("useSidebarSearch", () => {
  it("starts closed with an empty query", () => {
    const { result } = renderHook(() => useSidebarSearch({ isMobile: false }));
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("");
  });

  it("toggle opens then closes and clears the query", () => {
    const { result } = renderHook(() => useSidebarSearch({ isMobile: false }));
    act(() => {
      result.current.toggle();
    });
    expect(result.current.open).toBe(true);

    act(() => {
      result.current.setQuery("foo");
    });
    expect(result.current.query).toBe("foo");

    act(() => {
      result.current.toggle();
    });
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("");
  });

  it("close clears state regardless of prior open/query", () => {
    const { result } = renderHook(() => useSidebarSearch({ isMobile: false }));
    act(() => {
      result.current.toggle();
      result.current.setQuery("bar");
    });
    act(() => {
      result.current.close();
    });
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("");
  });

  it("Cmd-K opens the panel (desktop) without firing the mobile shortcut", () => {
    const onMobileOpenShortcut = vi.fn();
    const { result } = renderHook(() =>
      useSidebarSearch({ isMobile: false, onMobileOpenShortcut }),
    );
    let event!: KeyboardEvent;
    act(() => {
      event = dispatchCmdK({ meta: true });
    });
    expect(result.current.open).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(onMobileOpenShortcut).not.toHaveBeenCalled();
  });

  it("Cmd-K on mobile invokes the mobile-open callback", () => {
    const onMobileOpenShortcut = vi.fn();
    const { result } = renderHook(() =>
      useSidebarSearch({ isMobile: true, onMobileOpenShortcut }),
    );
    act(() => {
      dispatchCmdK({ meta: true });
    });
    expect(result.current.open).toBe(true);
    expect(onMobileOpenShortcut).toHaveBeenCalledTimes(1);
  });

  it("Ctrl-K acts identically to Cmd-K", () => {
    const { result } = renderHook(() => useSidebarSearch({ isMobile: false }));
    act(() => {
      dispatchCmdK({ ctrl: true });
    });
    expect(result.current.open).toBe(true);
  });

  it("Cmd-K toggles closed and clears the query", () => {
    const { result } = renderHook(() => useSidebarSearch({ isMobile: false }));
    act(() => {
      result.current.toggle();
      result.current.setQuery("baz");
    });
    act(() => {
      dispatchCmdK({ meta: true });
    });
    expect(result.current.open).toBe(false);
    expect(result.current.query).toBe("");
  });

  it("ignores K without a modifier", () => {
    const { result } = renderHook(() => useSidebarSearch({ isMobile: false }));
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "k" }));
    });
    expect(result.current.open).toBe(false);
  });

  it("ignores Cmd-K when alt or shift is also held", () => {
    const { result } = renderHook(() => useSidebarSearch({ isMobile: false }));
    act(() => {
      dispatchCmdK({ meta: true, alt: true });
    });
    expect(result.current.open).toBe(false);
    act(() => {
      dispatchCmdK({ meta: true, shift: true });
    });
    expect(result.current.open).toBe(false);
  });

  it("removes the keydown listener on unmount", () => {
    const { result, unmount } = renderHook(() =>
      useSidebarSearch({ isMobile: false }),
    );
    unmount();
    act(() => {
      dispatchCmdK({ meta: true });
    });
    // No further state to assert against -- result.current still reflects the
    // last in-mount snapshot. The test would surface an exception if the
    // listener stayed bound and tried to setState on the unmounted hook.
    expect(result.current.open).toBe(false);
  });
});
