import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SidebarChild } from "../model/types.js";
import { ChildRow } from "./ChildRow.js";

afterEach(() => {
  cleanup();
});

function child(overrides: Partial<SidebarChild>): SidebarChild {
  return {
    id: "terminal:s1",
    kind: "terminal",
    label: "codex",
    status: "idle",
    pinned: false,
    ...overrides,
  };
}

describe("ChildRow status icon switching", () => {
  it("exposes active statuses to the row accessible name", () => {
    const activeStatuses: Array<[SidebarChild["status"], string]> = [
      ["working", "status: working"],
      ["attention", "status: needs input"],
      ["review", "status: review"],
    ];

    for (const [status, accessibleStatus] of activeStatuses) {
      const { container, getByRole, unmount } = render(
        <ChildRow
          child={child({ status })}
          selected={false}
          onClick={() => undefined}
        />,
      );

      expect(
        getByRole("button", {
          name: new RegExp(`codex, ${accessibleStatus}`, "i"),
        }),
      ).toBeTruthy();
      expect(
        container.querySelector(".sr-only")?.textContent?.replace(/^, /, ""),
      ).toBe(accessibleStatus);

      unmount();
    }
  });

  it("uses a loader-circle status icon when working", () => {
    const { container, getByText } = render(
      <ChildRow child={child({ status: "working" })} selected={false} />,
    );

    const mark = container.querySelector(".agent-status-working");
    expect(mark).not.toBeNull();
    expect(mark?.tagName.toLowerCase()).toBe("svg");
    expect(mark?.parentElement?.className).toContain(
      "text-[var(--theme-git-modified)]",
    );
    expect(getByText("codex").className).toContain(
      "text-[var(--theme-git-modified)]",
    );
    expect(container.querySelector(".agent-status-attention")).toBeNull();
  });

  it("uses a circle-pause status icon when attention is needed", () => {
    const { container, getByText } = render(
      <ChildRow
        child={child({ kind: "browser", status: "attention" })}
        selected={false}
      />,
    );

    expect(container.querySelector(".agent-status-attention")).not.toBeNull();
    expect(container.querySelector(".agent-status-working")).toBeNull();
    expect(container.querySelector(".text-danger")).not.toBeNull();
    expect(getByText("codex").className).toContain("text-danger");
  });

  it("uses a circle-small status icon when idle", () => {
    const { container, getByText } = render(
      <ChildRow
        child={child({ kind: "browser", status: "idle" })}
        selected={false}
      />,
    );

    expect(container.querySelector(".agent-status-working")).toBeNull();
    expect(container.querySelector(".agent-status-attention")).toBeNull();
    expect(container.querySelector("svg circle[r='6']")).not.toBeNull();
    expect(getByText("codex").className).not.toContain("theme-git-modified");
    expect(getByText("codex").className).not.toContain("text-warning");
    expect(getByText("codex").className).not.toContain("text-danger");
    expect(getByText("codex").className).not.toContain("text-success");
  });

  it("uses a circle-small status icon when in review", () => {
    const { container, getByText } = render(
      <ChildRow
        child={child({ agentType: "claude", status: "review" })}
        selected={false}
      />,
    );

    expect(container.querySelector(".agent-status-working")).toBeNull();
    expect(container.querySelector(".agent-status-attention")).toBeNull();
    expect(container.querySelector("svg circle[r='6']")).not.toBeNull();
    expect(getByText("codex").className).toContain("text-success");
  });

  it("toggles Monitor pin without selecting the row", () => {
    const onClick = vi.fn();
    const onTogglePin = vi.fn();
    const { getByRole } = render(
      <ChildRow
        child={child({ pinned: false })}
        selected={false}
        onClick={onClick}
        onTogglePin={onTogglePin}
      />,
    );

    fireEvent.click(getByRole("button", { name: "Pin to Monitor" }));

    expect(onTogglePin).toHaveBeenCalledOnce();
    expect(onClick).not.toHaveBeenCalled();
  });
});
