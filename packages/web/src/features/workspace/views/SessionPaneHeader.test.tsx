import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionPaneHeader } from "./SessionPaneHeader.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SessionPaneHeader", () => {
  it("renders duplicate breadcrumb labels without a React key warning", () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    render(
      <SessionPaneHeader
        crumbs={[{ label: "main" }, { label: "main" }]}
        onToggleDrawer={() => undefined}
      />,
    );

    expect(screen.getAllByText("main")).toHaveLength(2);
    expect(
      consoleError.mock.calls.some((call) =>
        String(call[0]).includes("Encountered two children with the same key"),
      ),
    ).toBe(false);
  });
});
