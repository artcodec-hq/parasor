import {
  normalizeWorkItem,
  normalizeWorkItemsByProject,
  WORK_ITEM_ATTACHMENTS_MAX_COUNT,
} from "@parasor/shared";
import { describe, expect, it } from "vitest";

const validItem = {
  id: "work-1",
  projectId: "project-1",
  title: "Persist work items",
  status: "in_progress",
  acceptanceCriteria: [
    { id: "criterion-1", text: "Round trips", checked: true },
  ],
  attachments: [
    {
      id: "attachment-1",
      kind: "url",
      url: "https://example.com/evidence",
      label: "Evidence",
      attachedAt: 2,
    },
  ],
  createdAt: 1,
  updatedAt: 2,
};

describe("work item normalization", () => {
  it("normalizes valid persisted records and drops invalid project entries", () => {
    expect(
      normalizeWorkItemsByProject({
        "project-1": [validItem, { ...validItem, id: "work-2", status: "bad" }],
        mismatch: [{ ...validItem, id: "work-3" }],
        malformed: "not-an-array",
      }),
    ).toEqual({ "project-1": [validItem], mismatch: [] });
  });

  it("rejects records with attachments above the configured bound", () => {
    expect(
      normalizeWorkItem({
        ...validItem,
        attachments: Array.from(
          { length: WORK_ITEM_ATTACHMENTS_MAX_COUNT + 1 },
          (_, index) => ({
            id: `attachment-${index}`,
            kind: "url",
            url: "https://example.com",
            attachedAt: 2,
          }),
        ),
      }),
    ).toBeNull();
  });
});
