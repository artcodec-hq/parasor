export const WORK_ITEM_TITLE_MAX_LENGTH = 200;
export const WORK_ITEM_ACCEPTANCE_CRITERIA_MAX_COUNT = 50;
export const WORK_ITEM_ATTACHMENTS_MAX_COUNT = 500;
export const WORK_ITEM_NOTES_MAX_BYTES = 64 * 1024;

const WORK_ITEM_ID_MAX_LENGTH = 200;
const WORK_ITEM_TEXT_MAX_LENGTH = 4_096;
const WORK_ITEM_PATH_MAX_LENGTH = 4_096;
const WORK_ITEM_URL_MAX_LENGTH = 4_096;

export type WorkItemStatus =
  | "todo"
  | "in_progress"
  | "blocked"
  | "review"
  | "done";

export interface WorkItem {
  id: string;
  projectId: string;
  primaryWorktreePath?: string;
  title: string;
  status: WorkItemStatus;
  acceptanceCriteria: WorkItemCriterion[];
  notes?: string;
  externalIssue?: ExternalIssueLink;
  attachments: WorkItemAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface WorkItemCriterion {
  id: string;
  text: string;
  checked: boolean;
}

export interface ExternalIssueLink {
  provider: "github";
  repository: string;
  number: number;
  url: string;
  lastReadAt?: number;
}

export type WorkItemAttachment =
  | {
      id: string;
      kind: "session";
      sessionId: string;
      worktreePath: string;
      attachedAt: number;
    }
  | {
      id: string;
      kind: "file";
      worktreePath: string;
      path: string;
      selection?: { startLine: number; endLine: number };
      attachedAt: number;
    }
  | {
      id: string;
      kind: "git";
      worktreePath: string;
      target: { type: "working-tree" } | { type: "commit"; sha: string };
      attachedAt: number;
    }
  | {
      id: string;
      kind: "service";
      worktreePath: string;
      serviceId: string;
      urlAtAttach?: string;
      attachedAt: number;
    }
  | {
      id: string;
      kind: "url";
      url: string;
      label?: string;
      attachedAt: number;
    };

export interface CreateWorkItemInput {
  title: string;
  status?: WorkItemStatus;
  acceptanceCriteria?: WorkItemCriterion[];
  notes?: string;
  primaryWorktreePath?: string;
}

export interface UpdateWorkItemInput {
  title?: string;
  status?: WorkItemStatus;
  acceptanceCriteria?: WorkItemCriterion[];
  notes?: string | null;
  primaryWorktreePath?: string | null;
}

const WORK_ITEM_STATUSES: WorkItemStatus[] = [
  "todo",
  "in_progress",
  "blocked",
  "review",
  "done",
];

export function normalizeWorkItemsByProject(
  value: unknown,
): Record<string, WorkItem[]> {
  if (!isPlainObject(value)) return {};
  const result: Record<string, WorkItem[]> = {};
  for (const [projectId, rawItems] of Object.entries(value)) {
    if (!boundedString(projectId, WORK_ITEM_ID_MAX_LENGTH)) continue;
    if (!Array.isArray(rawItems)) continue;
    const seen = new Set<string>();
    const items: WorkItem[] = [];
    for (const rawItem of rawItems) {
      const item = normalizeWorkItem(rawItem);
      if (!item || item.projectId !== projectId || seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
    result[projectId] = items;
  }
  return result;
}

export function normalizeWorkItem(value: unknown): WorkItem | null {
  if (!isPlainObject(value)) return null;
  const id = boundedString(value.id, WORK_ITEM_ID_MAX_LENGTH);
  const projectId = boundedString(value.projectId, WORK_ITEM_ID_MAX_LENGTH);
  const title = normalizeTitle(value.title);
  const status = normalizeStatus(value.status);
  const acceptanceCriteria = normalizeCriteria(value.acceptanceCriteria);
  const attachments = normalizeAttachments(value.attachments);
  const createdAt = normalizeTimestamp(value.createdAt);
  const updatedAt = normalizeTimestamp(value.updatedAt);
  if (
    !id ||
    !projectId ||
    !title ||
    !status ||
    !acceptanceCriteria ||
    !attachments ||
    createdAt === null ||
    updatedAt === null ||
    updatedAt < createdAt
  ) {
    return null;
  }

  const primaryWorktreePath = optionalBoundedString(
    value.primaryWorktreePath,
    WORK_ITEM_PATH_MAX_LENGTH,
  );
  const notes = optionalNotes(value.notes);
  const externalIssue = optionalExternalIssue(value.externalIssue);
  if (
    primaryWorktreePath === null ||
    notes === null ||
    externalIssue === null
  ) {
    return null;
  }

  return {
    id,
    projectId,
    title,
    status,
    acceptanceCriteria,
    attachments,
    createdAt,
    updatedAt,
    ...(primaryWorktreePath === undefined ? {} : { primaryWorktreePath }),
    ...(notes === undefined ? {} : { notes }),
    ...(externalIssue === undefined ? {} : { externalIssue }),
  };
}

export function normalizeCreateWorkItemInput(
  value: unknown,
): CreateWorkItemInput | null {
  if (!isPlainObject(value)) return null;
  const title = normalizeTitle(value.title);
  if (!title) return null;
  const status =
    value.status === undefined ? undefined : normalizeStatus(value.status);
  const acceptanceCriteria =
    value.acceptanceCriteria === undefined
      ? undefined
      : normalizeCriteria(value.acceptanceCriteria);
  const notes = optionalNotes(value.notes);
  const primaryWorktreePath = optionalBoundedString(
    value.primaryWorktreePath,
    WORK_ITEM_PATH_MAX_LENGTH,
  );
  if (
    status === null ||
    acceptanceCriteria === null ||
    notes === null ||
    primaryWorktreePath === null
  ) {
    return null;
  }
  return {
    title,
    ...(status === undefined ? {} : { status }),
    ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }),
    ...(notes === undefined ? {} : { notes }),
    ...(primaryWorktreePath === undefined ? {} : { primaryWorktreePath }),
  };
}

export function normalizeUpdateWorkItemInput(
  value: unknown,
): UpdateWorkItemInput | null {
  if (!isPlainObject(value)) return null;
  const result: UpdateWorkItemInput = {};
  let hasField = false;

  if (value.title !== undefined) {
    const title = normalizeTitle(value.title);
    if (!title) return null;
    result.title = title;
    hasField = true;
  }
  if (value.status !== undefined) {
    const status = normalizeStatus(value.status);
    if (!status) return null;
    result.status = status;
    hasField = true;
  }
  if (value.acceptanceCriteria !== undefined) {
    const acceptanceCriteria = normalizeCriteria(value.acceptanceCriteria);
    if (!acceptanceCriteria) return null;
    result.acceptanceCriteria = acceptanceCriteria;
    hasField = true;
  }
  if (value.notes !== undefined) {
    if (value.notes === null) {
      result.notes = null;
    } else {
      const notes = optionalNotes(value.notes);
      if (notes === null || notes === undefined) return null;
      result.notes = notes;
    }
    hasField = true;
  }
  if (value.primaryWorktreePath !== undefined) {
    if (value.primaryWorktreePath === null) {
      result.primaryWorktreePath = null;
    } else {
      const path = optionalBoundedString(
        value.primaryWorktreePath,
        WORK_ITEM_PATH_MAX_LENGTH,
      );
      if (path === null || path === undefined) return null;
      result.primaryWorktreePath = path;
    }
    hasField = true;
  }

  return hasField ? result : null;
}

function normalizeTitle(value: unknown): string | null {
  return boundedString(value, WORK_ITEM_TITLE_MAX_LENGTH);
}

function normalizeStatus(value: unknown): WorkItemStatus | null {
  return typeof value === "string" &&
    WORK_ITEM_STATUSES.includes(value as WorkItemStatus)
    ? (value as WorkItemStatus)
    : null;
}

function normalizeCriteria(value: unknown): WorkItemCriterion[] | null {
  if (
    !Array.isArray(value) ||
    value.length > WORK_ITEM_ACCEPTANCE_CRITERIA_MAX_COUNT
  ) {
    return null;
  }
  const result: WorkItemCriterion[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!isPlainObject(raw)) return null;
    const id = boundedString(raw.id, WORK_ITEM_ID_MAX_LENGTH);
    const criterionText = boundedString(raw.text, WORK_ITEM_TEXT_MAX_LENGTH);
    if (
      !id ||
      !criterionText ||
      typeof raw.checked !== "boolean" ||
      seen.has(id)
    ) {
      return null;
    }
    seen.add(id);
    result.push({ id, text: criterionText, checked: raw.checked });
  }
  return result;
}

function normalizeAttachments(value: unknown): WorkItemAttachment[] | null {
  if (!Array.isArray(value) || value.length > WORK_ITEM_ATTACHMENTS_MAX_COUNT) {
    return null;
  }
  const result: WorkItemAttachment[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const attachment = normalizeAttachment(raw);
    if (!attachment || seen.has(attachment.id)) return null;
    seen.add(attachment.id);
    result.push(attachment);
  }
  return result;
}

function normalizeAttachment(value: unknown): WorkItemAttachment | null {
  if (!isPlainObject(value)) return null;
  const id = boundedString(value.id, WORK_ITEM_ID_MAX_LENGTH);
  const attachedAt = normalizeTimestamp(value.attachedAt);
  if (!id || attachedAt === null) return null;

  if (value.kind === "url") {
    const url = boundedUrl(value.url);
    const label = optionalBoundedString(
      value.label,
      WORK_ITEM_TITLE_MAX_LENGTH,
    );
    if (!url || label === null) return null;
    return { id, kind: "url", url, attachedAt, ...(label ? { label } : {}) };
  }

  const worktreePath = boundedString(
    value.worktreePath,
    WORK_ITEM_PATH_MAX_LENGTH,
  );
  if (!worktreePath) return null;
  if (value.kind === "session") {
    const sessionId = boundedString(value.sessionId, WORK_ITEM_ID_MAX_LENGTH);
    return sessionId
      ? { id, kind: "session", sessionId, worktreePath, attachedAt }
      : null;
  }
  if (value.kind === "file") {
    const path = boundedString(value.path, WORK_ITEM_PATH_MAX_LENGTH);
    const selection = normalizeSelection(value.selection);
    if (!path || selection === null) return null;
    return {
      id,
      kind: "file",
      worktreePath,
      path,
      attachedAt,
      ...(selection ? { selection } : {}),
    };
  }
  if (value.kind === "git") {
    const target = normalizeGitTarget(value.target);
    return target
      ? { id, kind: "git", worktreePath, target, attachedAt }
      : null;
  }
  if (value.kind === "service") {
    const serviceId = boundedString(value.serviceId, WORK_ITEM_ID_MAX_LENGTH);
    const urlAtAttach = optionalUrl(value.urlAtAttach);
    if (!serviceId || urlAtAttach === null) return null;
    return {
      id,
      kind: "service",
      worktreePath,
      serviceId,
      attachedAt,
      ...(urlAtAttach ? { urlAtAttach } : {}),
    };
  }
  return null;
}

function optionalExternalIssue(
  value: unknown,
): ExternalIssueLink | undefined | null {
  if (value === undefined) return undefined;
  if (!isPlainObject(value) || value.provider !== "github") return null;
  const repository = boundedString(value.repository, WORK_ITEM_PATH_MAX_LENGTH);
  const url = boundedUrl(value.url);
  const lastReadAt =
    value.lastReadAt === undefined
      ? undefined
      : normalizeTimestamp(value.lastReadAt);
  if (
    !repository ||
    !url ||
    !Number.isSafeInteger(value.number) ||
    (value.number as number) <= 0 ||
    lastReadAt === null
  ) {
    return null;
  }
  return {
    provider: "github",
    repository,
    number: value.number as number,
    url,
    ...(lastReadAt === undefined ? {} : { lastReadAt }),
  };
}

function normalizeSelection(
  value: unknown,
): { startLine: number; endLine: number } | undefined | null {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return null;
  if (
    !Number.isSafeInteger(value.startLine) ||
    !Number.isSafeInteger(value.endLine) ||
    (value.startLine as number) <= 0 ||
    (value.endLine as number) < (value.startLine as number)
  ) {
    return null;
  }
  return {
    startLine: value.startLine as number,
    endLine: value.endLine as number,
  };
}

function normalizeGitTarget(
  value: unknown,
): Extract<WorkItemAttachment, { kind: "git" }>["target"] | null {
  if (!isPlainObject(value)) return null;
  if (value.type === "working-tree") return { type: "working-tree" };
  if (value.type !== "commit") return null;
  const sha = boundedString(value.sha, WORK_ITEM_ID_MAX_LENGTH);
  return sha ? { type: "commit", sha } : null;
}

function normalizeTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function optionalNotes(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  return new TextEncoder().encode(value).byteLength <= WORK_ITEM_NOTES_MAX_BYTES
    ? value
    : null;
}

function boundedUrl(value: unknown): string | null {
  const url = boundedString(value, WORK_ITEM_URL_MAX_LENGTH);
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? url
      : null;
  } catch {
    return null;
  }
}

function optionalUrl(value: unknown): string | undefined | null {
  return value === undefined ? undefined : boundedUrl(value);
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength
    ? normalized
    : null;
}

function optionalBoundedString(
  value: unknown,
  maxLength: number,
): string | undefined | null {
  return value === undefined ? undefined : boundedString(value, maxLength);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
