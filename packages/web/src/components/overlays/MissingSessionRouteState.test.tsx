import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MissingSessionRouteState } from "./MissingSessionRouteState.js";

afterEach(() => {
  cleanup();
});

describe("MissingSessionRouteState", () => {
  it("renders the hydrated 'Session not found' branch when hydrated is true", () => {
    render(
      <MissingSessionRouteState
        sessionId="abc-123"
        hydrated={true}
        connected={true}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Session not found")).toBeTruthy();
    expect(
      screen.getByText(/no longer present in the server state/i),
    ).toBeTruthy();
    expect(screen.getByText("SESSION MISSING")).toBeTruthy();
    expect(screen.getByText("abc-123")).toBeTruthy();
  });

  it("renders the 'Opening session' + snapshot-wait branch when not hydrated but connected", () => {
    render(
      <MissingSessionRouteState
        sessionId="s1"
        hydrated={false}
        connected={true}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Opening session")).toBeTruthy();
    expect(screen.getByText(/Waiting for the server snapshot/i)).toBeTruthy();
    expect(screen.getByText("SESSION")).toBeTruthy();
  });

  it("renders the 'Opening session' + connection-wait branch when not hydrated and not connected", () => {
    render(
      <MissingSessionRouteState
        sessionId="s1"
        hydrated={false}
        connected={false}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText("Opening session")).toBeTruthy();
    expect(screen.getByText(/Waiting for the server connection/i)).toBeTruthy();
  });

  it("invokes onClose when the Close action is clicked", () => {
    const onClose = vi.fn();
    render(
      <MissingSessionRouteState
        sessionId="s1"
        hydrated={true}
        connected={true}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
