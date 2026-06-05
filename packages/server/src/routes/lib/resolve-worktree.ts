import { WorkspaceNotFoundError } from "../../application/workspace/errors.js";

export type ResolveWorktreeResult =
  | { ok: true; resolved: string }
  | { ok: false; status: 400 | 404; body: { error: string } };

type FenceWorktreePath = (
  projectId: string,
  worktreePath: string,
) => Promise<{ projectPath: string; resolved: string }>;

/**
 * Interface-layer glue around the application `fenceWorktreePath` command.
 * Maps the path-fencing outcome to the HTTP status/body the routes have
 * always returned, keeping the security-sensitive fence single-sourced in
 * `application/workspace/worktree-commands.ts`.
 *
 * Body parity (behavior-preserving):
 *   - missing / non-string path -> 400 "worktreePath is required"
 *   - project not found (`WorkspaceNotFoundError.kind === "project"`)
 *       -> 404 "Project not found"
 *   - unregistered worktree (`kind === "worktree"`)
 *       -> 404 with the original `WorktreeNotRegisteredError` message
 */
export async function resolveWorktreeOrError(
  fenceWorktreePath: FenceWorktreePath,
  projectId: string,
  worktreePath: string | undefined,
): Promise<ResolveWorktreeResult> {
  if (!worktreePath || typeof worktreePath !== "string") {
    return {
      ok: false,
      status: 400,
      body: { error: "worktreePath is required" },
    };
  }
  try {
    const { resolved } = await fenceWorktreePath(projectId, worktreePath);
    return { ok: true, resolved };
  } catch (err) {
    if (err instanceof WorkspaceNotFoundError) {
      const error = err.kind === "project" ? "Project not found" : err.message;
      return { ok: false, status: 404, body: { error } };
    }
    throw err;
  }
}
