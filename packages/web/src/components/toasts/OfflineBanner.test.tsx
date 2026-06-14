import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OfflineBanner } from "./OfflineBanner.js";

describe("OfflineBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders nothing while connected", () => {
    const { container } = render(<OfflineBanner connected={true} />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing immediately on disconnect", () => {
    const { container } = render(<OfflineBanner connected={false} />);
    expect(container.firstChild).toBeNull();
  });

  it("shows banner after 5s of disconnection", () => {
    const { container } = render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.getAttribute("aria-labelledby")).toBe("offline-title");
    expect(container.querySelector("button")?.textContent).toMatch(/reload/i);
  });

  it("waits for the recovery hard deadline when event socket status is available", () => {
    const now = Date.now();
    const { container } = render(
      <OfflineBanner
        connected={false}
        status={{
          phase: "recovering",
          disconnectedAt: now,
          lastProgressAt: now,
          nextRetryAt: now + 2000,
          attempt: 1,
        }}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.firstChild).toBeNull();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("waits for a scheduled retry to settle before showing the reload prompt", () => {
    const now = Date.now();
    const { container } = render(
      <OfflineBanner
        connected={false}
        status={{
          phase: "recovering",
          disconnectedAt: now - 25_000,
          lastProgressAt: now,
          nextRetryAt: now + 5000,
          attempt: 3,
        }}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(5999);
    });
    expect(container.firstChild).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("uses the longer startup deadline while the event socket is initially connecting", () => {
    const now = Date.now();
    const { container } = render(
      <OfflineBanner
        connected={false}
        status={{ phase: "connecting", since: now }}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.firstChild).toBeNull();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("hides banner if reconnects before delay elapses", () => {
    const { rerender, container } = render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    rerender(<OfflineBanner connected={true} />);
    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(container.firstChild).toBeNull();
  });

  it("hides banner immediately when reconnects after showing", () => {
    const { rerender, container } = render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    rerender(<OfflineBanner connected={true} />);
    expect(container.firstChild).toBeNull();
  });

  it("moves focus to Reload button when shown", () => {
    render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const active = document.activeElement as HTMLElement | null;
    expect(active?.tagName).toBe("BUTTON");
    expect(active?.textContent).toMatch(/reload/i);
  });

  it("restores focus to prior element on reconnect", () => {
    const prior = document.createElement("button");
    prior.textContent = "prior";
    document.body.appendChild(prior);
    prior.focus();
    expect(document.activeElement).toBe(prior);

    const { rerender } = render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect((document.activeElement as HTMLElement).textContent).toMatch(
      /reload/i,
    );

    rerender(<OfflineBanner connected={true} />);
    expect(document.activeElement).toBe(prior);

    prior.remove();
  });

  it("blocks keydown on document outside the dialog", () => {
    render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    const outside = document.createElement("input");
    document.body.appendChild(outside);
    const spy = vi.fn();
    outside.addEventListener("keydown", spy);

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    outside.dispatchEvent(event);

    expect(spy).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);

    outside.remove();
  });

  it("traps Tab on the Reload button", () => {
    render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const reload = document.activeElement as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    reload.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(reload);
  });

  it("blocks modifier shortcuts dispatched from the Reload button", () => {
    render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const reload = document.activeElement as HTMLElement;
    const windowSpy = vi.fn();
    window.addEventListener("keydown", windowSpy);

    const ctrlEnter = new KeyboardEvent("keydown", {
      key: "Enter",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    reload.dispatchEvent(ctrlEnter);
    expect(ctrlEnter.defaultPrevented).toBe(true);
    expect(windowSpy).not.toHaveBeenCalled();

    const escapeKey = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    reload.dispatchEvent(escapeKey);
    expect(escapeKey.defaultPrevented).toBe(true);

    window.removeEventListener("keydown", windowSpy);
  });

  it("allows bare Enter to activate the Reload button", () => {
    render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const reload = document.activeElement as HTMLElement;
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    reload.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not dismiss on Escape", () => {
    const { container } = render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  });

  it("prevents contextmenu on the overlay", () => {
    const { container } = render(<OfflineBanner connected={false} />);
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    const overlay = container.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement;
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    });
    const dispatched = overlay.dispatchEvent(event);
    expect(dispatched).toBe(false);
  });
});
