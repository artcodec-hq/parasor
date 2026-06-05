import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ReconnectingOverlay } from "./ReconnectingOverlay.js";

describe("ReconnectingOverlay", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("uses the default delay before showing", () => {
    vi.useFakeTimers();

    render(<ReconnectingOverlay />);

    expect(screen.queryByText("Reconnecting…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(749);
    });
    expect(screen.queryByText("Reconnecting…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
  });

  it("uses a custom delay before showing", () => {
    vi.useFakeTimers();

    render(<ReconnectingOverlay showDelayMs={2500} />);

    act(() => {
      vi.advanceTimersByTime(2499);
    });
    expect(screen.queryByText("Reconnecting…")).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByText("Reconnecting…")).toBeTruthy();
  });

  it("renders custom title and detail after the delay", () => {
    vi.useFakeTimers();

    render(
      <ReconnectingOverlay
        showDelayMs={100}
        title="Connecting…"
        detail="checking session"
      />,
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByText("Connecting…")).toBeTruthy();
    expect(screen.getByText("checking session")).toBeTruthy();
    expect(screen.queryByText("Reconnecting…")).toBeNull();
  });
});
