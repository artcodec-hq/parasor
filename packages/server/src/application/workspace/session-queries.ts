import { execFile } from "node:child_process";
import { readlink } from "node:fs/promises";
import { promisify } from "node:util";
import type { PtyHost } from "../../pty/host.js";
import { WorkspaceConflictError, WorkspaceNotFoundError } from "./errors.js";

const execFileAsync = promisify(execFile);

interface CreateSessionQueriesDeps {
  ptyManager: PtyHost;
  platform?: NodeJS.Platform;
  readProcessCwd?: (pid: number, fallback: string) => Promise<string>;
}

async function defaultReadProcessCwd(
  pid: number,
  fallback: string,
  platform = process.platform,
): Promise<string> {
  try {
    if (platform === "darwin") {
      const { stdout } = await execFileAsync("lsof", [
        "-a",
        "-d",
        "cwd",
        "-p",
        String(pid),
        "-F",
        "n",
      ]);
      const lines = stdout.trim().split("\n");
      const cwdLine = lines.findLast(
        (line) => line.startsWith("n") && line !== "ncwd",
      );
      return cwdLine?.slice(1) || fallback;
    }

    return (await readlink(`/proc/${pid}/cwd`)) || fallback;
  } catch {
    return fallback;
  }
}

export function createSessionQueries({
  ptyManager,
  platform = process.platform,
  readProcessCwd = (pid, fallback) =>
    defaultReadProcessCwd(pid, fallback, platform),
}: CreateSessionQueriesDeps) {
  return {
    listSessions(projectId?: string) {
      return projectId
        ? ptyManager.listByProject(projectId)
        : ptyManager.list();
    },

    async getSessionCwd(id: string) {
      const session = ptyManager.get(id);
      if (!session) {
        throw new WorkspaceNotFoundError();
      }
      if (session.state !== "running" || session.pid === null) {
        throw new WorkspaceConflictError("Session not running");
      }

      return { cwd: await readProcessCwd(session.pid, session.cwd) };
    },
  };
}
