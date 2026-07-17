import type { WorkItem, Worktree } from "@parasor/shared";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkItemPaneView } from "./WorkItemPaneView.js";

const ITEM: WorkItem = {
  id: "item-1",
  projectId: "project-1",
  title: "Ship pane",
  status: "todo",
  acceptanceCriteria: [
    { id: "criterion-1", text: "Editor persists", checked: false },
  ],
  attachments: [],
  createdAt: 1,
  updatedAt: 1,
};

const WORKTREES: Worktree[] = [
  {
    path: "/repo",
    branch: "dev",
    head: "abc",
    ahead: 0,
    behind: 0,
    dirtyCount: 0,
  },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("WorkItemPaneView", () => {
  it("saves editable local work item fields", async () => {
    const onSave = vi.fn();
    render(
      <WorkItemPaneView
        item={ITEM}
        worktrees={WORKTREES}
        onDelete={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Ship local editor" },
    });
    fireEvent.change(screen.getByLabelText("Status"), {
      target: { value: "review" },
    });
    fireEvent.click(screen.getByLabelText("Criterion complete"));
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Ready for review" },
    });
    fireEvent.change(screen.getByLabelText("Primary worktree"), {
      target: { value: "/repo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      title: "Ship local editor",
      status: "review",
      acceptanceCriteria: [
        { id: "criterion-1", text: "Editor persists", checked: true },
      ],
      notes: "Ready for review",
      primaryWorktreePath: "/repo",
    });
    expect(screen.getByText(/No attachments yet/)).toBeTruthy();
  });

  it("deletes only after confirmation", async () => {
    const onDelete = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(
      <WorkItemPaneView
        item={ITEM}
        worktrees={WORKTREES}
        onDelete={onDelete}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete work item" }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
  });
});
