import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  WORK_ITEM_ACCEPTANCE_CRITERIA_MAX_COUNT,
  WORK_ITEM_NOTES_MAX_BYTES,
  WORK_ITEM_TITLE_MAX_LENGTH,
} from "@parasor/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { ProjectManager } from "../state/project-manager.js";
import { EventBus } from "../ws/events.js";
import { createWorkItemRoutes } from "./work-items.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "parasor-work-items-"));
}

describe("createWorkItemRoutes", () => {
  let appStateStore: AppStateStore;
  let eventBus: EventBus;
  let projectManager: ProjectManager;
  let projectId: string;

  beforeEach(() => {
    appStateStore = new AppStateStore({ dir: tempDir(), debounceMs: 99_999 });
    eventBus = new EventBus();
    projectManager = new ProjectManager(appStateStore);
    projectId = projectManager.create({ path: "/tmp/work-items" }).id;
  });

  afterEach(() => {
    appStateStore.destroy();
  });

  it("creates, lists, updates, and deletes local work item fields", async () => {
    const app = createWorkItemRoutes({
      appStateStore,
      eventBus,
      projectManager,
    });
    const broadcast = vi.spyOn(eventBus, "broadcast");

    const createResponse = await app.request(`/${projectId}/work-items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: "client-controlled",
        title: "  Ship storage  ",
        acceptanceCriteria: [
          { id: "criterion-1", text: " Persists ", checked: false },
        ],
        attachments: [{ id: "ignored", kind: "url", url: "https://x.dev" }],
        createdAt: 1,
      }),
    });
    expect(createResponse.status).toBe(201);
    const created = (await createResponse.json()).workItem;
    expect(created).toMatchObject({
      projectId,
      title: "Ship storage",
      status: "todo",
      acceptanceCriteria: [
        { id: "criterion-1", text: "Persists", checked: false },
      ],
      attachments: [],
    });
    expect(created.id).not.toBe("client-controlled");
    expect(created.createdAt).toBe(created.updatedAt);
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "work-item-created",
      item: created,
    });

    const listResponse = await app.request(`/${projectId}/work-items`);
    expect(await listResponse.json()).toEqual({ workItems: [created] });

    const updateResponse = await app.request(
      `/${projectId}/work-items/${created.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "review", notes: "Ready" }),
      },
    );
    expect(updateResponse.status).toBe(200);
    const updated = (await updateResponse.json()).workItem;
    expect(updated).toMatchObject({ status: "review", notes: "Ready" });
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "work-item-updated",
      item: updated,
    });

    const deleteResponse = await app.request(
      `/${projectId}/work-items/${created.id}`,
      { method: "DELETE" },
    );
    expect(deleteResponse.status).toBe(200);
    expect(appStateStore.get().workItems[projectId]).toEqual([]);
    expect(broadcast).toHaveBeenLastCalledWith({
      type: "work-item-deleted",
      projectId,
      workItemId: created.id,
    });
  });

  it("rejects unknown projects, missing items, and bounded field violations", async () => {
    const app = createWorkItemRoutes({
      appStateStore,
      eventBus,
      projectManager,
    });
    const invalidBodies = [
      { title: "x".repeat(WORK_ITEM_TITLE_MAX_LENGTH + 1) },
      {
        title: "Too many criteria",
        acceptanceCriteria: Array.from(
          { length: WORK_ITEM_ACCEPTANCE_CRITERIA_MAX_COUNT + 1 },
          (_, index) => ({ id: `${index}`, text: "criterion", checked: false }),
        ),
      },
      {
        title: "Notes too large",
        notes: "x".repeat(WORK_ITEM_NOTES_MAX_BYTES + 1),
      },
    ];
    for (const body of invalidBodies) {
      const response = await app.request(`/${projectId}/work-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }

    const unknownProject = await app.request("/missing/work-items");
    expect(unknownProject.status).toBe(404);
    const missingItem = await app.request(`/${projectId}/work-items/missing`, {
      method: "DELETE",
    });
    expect(missingItem.status).toBe(404);
  });

  it("opens, reuses, and closes a work item pane on a registered worktree", async () => {
    const app = createWorkItemRoutes({
      appStateStore,
      eventBus,
      projectManager,
    });
    const created = await (
      await app.request(`/${projectId}/work-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Editable pane" }),
      })
    ).json();

    const open = () =>
      app.request(`/${projectId}/work-items/${created.workItem.id}/panes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ worktreePath: "/tmp/work-items" }),
      });
    const first = await (await open()).json();
    const second = await (await open()).json();
    expect(second.pane.id).toBe(first.pane.id);
    expect(
      first.worktrees[0].panes.map((pane: { kind: string }) => pane.kind),
    ).toEqual(["files", "work-item", "git"]);

    const closed = await app.request(
      `/${projectId}/work-item-panes/${encodeURIComponent(first.pane.id)}`,
      { method: "DELETE" },
    );
    expect(closed.status).toBe(200);
    expect(
      (await closed.json()).worktrees[0].panes.map(
        (pane: { kind: string }) => pane.kind,
      ),
    ).toEqual(["files", "git"]);
    const closedAgain = await app.request(
      `/${projectId}/work-item-panes/${encodeURIComponent(first.pane.id)}`,
      { method: "DELETE" },
    );
    expect(closedAgain.status).toBe(404);
  });

  it("removes every pane for a deleted work item", async () => {
    const app = createWorkItemRoutes({
      appStateStore,
      eventBus,
      projectManager,
    });
    const created = await (
      await app.request(`/${projectId}/work-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Delete me" }),
      })
    ).json();
    await app.request(`/${projectId}/work-items/${created.workItem.id}/panes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ worktreePath: "/tmp/work-items" }),
    });

    await app.request(`/${projectId}/work-items/${created.workItem.id}`, {
      method: "DELETE",
    });
    expect(
      appStateStore
        .get()
        .projectStates[projectId].worktrees[0].panes.some(
          (pane) => pane.state.kind === "work-item",
        ),
    ).toBe(false);
  });
});
