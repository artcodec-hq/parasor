import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type DiffFile, DiffFileBlock } from "./diff-render.js";

afterEach(() => cleanup());

function diffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return {
    status: "Modified",
    path: "src/App.tsx",
    hunks: [],
    added: 1,
    removed: 1,
    ...overrides,
  };
}

describe("DiffFileBlock", () => {
  it("opens the current diff file path when available", () => {
    const onOpenFilePath = vi.fn();
    render(<DiffFileBlock file={diffFile()} onOpenFilePath={onOpenFilePath} />);

    fireEvent.click(screen.getByRole("button", { name: "src/App.tsx" }));

    expect(onOpenFilePath).toHaveBeenCalledWith("src/App.tsx");
  });

  it("does not render an open control for removed files", () => {
    render(
      <DiffFileBlock
        file={diffFile({ status: "Removed", path: "src/old.ts" })}
        onOpenFilePath={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "src/old.ts" })).toBeNull();
    expect(screen.getByText("src/old.ts")).toBeTruthy();
  });
});
