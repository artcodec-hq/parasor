/**
 * Distinguishes *why* a workspace lookup failed without changing the
 * human-readable `message`. `"project"` = the project id is unknown;
 * `"worktree"` = the project exists but the supplied worktree path is not
 * registered. The route layer maps these to byte-identical HTTP bodies that
 * predate the application extraction ("Project not found" vs the original
 * "Worktree not registered: <path>" message), so the discriminator carries
 * that distinction across the boundary without re-running the path fence.
 */
export type WorkspaceNotFoundKind = "project" | "worktree";

export class WorkspaceNotFoundError extends Error {
  readonly kind: WorkspaceNotFoundKind;

  constructor(message = "Not found", kind: WorkspaceNotFoundKind = "project") {
    super(message);
    this.name = "WorkspaceNotFoundError";
    this.kind = kind;
  }
}

export class WorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceConflictError";
  }
}

export class WorkspaceValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceValidationError";
  }
}

export class WorkItemNotFoundError extends Error {
  constructor() {
    super("Work item not found");
    this.name = "WorkItemNotFoundError";
  }
}
