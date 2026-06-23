import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MonitorSwitchButton } from "./MonitorSwitchButton.js";

afterEach(() => {
  cleanup();
});

describe("MonitorSwitchButton", () => {
  it("uses the sidebar surface track by default", () => {
    const { getByRole } = render(
      <MonitorSwitchButton pressed={false} onClick={vi.fn()} />,
    );

    const button = getByRole("button", { name: "Pin to Monitor" });
    const track = button.querySelector("span");

    expect(track?.className).toContain("bg-bg-primary/80");
  });

  it("uses the provided className for non-sidebar surfaces", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <MonitorSwitchButton
        pressed={true}
        className="bg-bg-secondary"
        onClick={onClick}
      />,
    );

    const button = getByRole("button", { name: "Remove from Monitor" });
    const track = button.querySelector("span");

    expect(track?.className).toContain("bg-bg-secondary");
    expect(track?.className).not.toContain("bg-bg-primary/80");

    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });
});
