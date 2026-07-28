import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceEmptyState } from "./WorkspaceEmptyState.js";

afterEach(() => cleanup());

describe("WorkspaceEmptyState", () => {
  it("renders the branded logo with the active theme text color", () => {
    render(
      <WorkspaceEmptyState
        activeProjectId={null}
        hydrated
        onNewProject={vi.fn()}
      />,
    );

    const logo = screen.getByRole("img", { name: "parasor" });

    expect(logo.className).toContain("text-text-primary");
    expect(logo.style.maskImage).toBe('url("/parasor-logo.svg")');
    expect(screen.queryByText("parasor")).toBeNull();
  });
});
