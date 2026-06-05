import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EditablePaneTitle } from "./EditablePaneTitle.js";

describe("EditablePaneTitle", () => {
  afterEach(() => cleanup());

  it("saves a trimmed title on Enter", async () => {
    const onSave = vi.fn();
    const { getByRole } = render(
      <EditablePaneTitle value="bash" onSave={onSave} />,
    );

    fireEvent.click(getByRole("button", { name: "Rename terminal" }));
    const input = getByRole("textbox", { name: "Terminal title" });
    fireEvent.change(input, { target: { value: "  Build logs  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Build logs"));
  });

  it("focuses the title input when rename is tapped", () => {
    const onSave = vi.fn();
    const { getByRole } = render(
      <EditablePaneTitle value="bash" onSave={onSave} />,
    );

    fireEvent.click(getByRole("button", { name: "Rename terminal" }));
    const input = getByRole("textbox", { name: "Terminal title" });

    expect(document.activeElement).toBe(input);
  });

  it("cancels editing on Escape", () => {
    const onSave = vi.fn();
    const { getByRole, queryByRole } = render(
      <EditablePaneTitle value="bash" onSave={onSave} />,
    );

    fireEvent.click(getByRole("button", { name: "Rename terminal" }));
    const input = getByRole("textbox", { name: "Terminal title" });
    fireEvent.change(input, { target: { value: "Build logs" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(queryByRole("textbox", { name: "Terminal title" })).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("saves an empty title on blur to reset to the default title", async () => {
    const onSave = vi.fn();
    const { getByRole } = render(
      <EditablePaneTitle value="Build logs" onSave={onSave} />,
    );

    fireEvent.click(getByRole("button", { name: "Rename terminal" }));
    const input = getByRole("textbox", { name: "Terminal title" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);

    await waitFor(() => expect(onSave).toHaveBeenCalledWith(""));
  });
});
