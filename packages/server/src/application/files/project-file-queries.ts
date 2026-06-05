import type { FilesystemService } from "../../fs/service.js";
import type { ProjectManager } from "../../state/project-manager.js";
import { WorkspaceNotFoundError } from "../workspace/errors.js";
import {
  FileAccessError,
  FileExistsError,
  FileNotFoundError,
  FileReadError,
  FilesystemUnavailableError,
  FileTooLargeError,
  FileWriteDisabledError,
  FileWriteError,
} from "./errors.js";

interface CreateProjectFileQueriesDeps {
  getFilesystemService: (
    projectId: string,
    worktreePath?: string,
  ) => FilesystemService | null;
  projectManager: ProjectManager;
  isWritable?: (projectId: string) => boolean;
}

export function createProjectFileQueries({
  getFilesystemService,
  projectManager,
  isWritable,
}: CreateProjectFileQueriesDeps) {
  function getFilesystemOrThrow(projectId: string, worktreePath?: string) {
    const project = projectManager.get(projectId);
    if (!project) {
      throw new WorkspaceNotFoundError("Project not found");
    }

    const service = getFilesystemService(projectId, worktreePath);
    if (!service) {
      throw new FilesystemUnavailableError();
    }

    return service;
  }

  return {
    async listProjectDirectory(
      projectId: string,
      path = ".",
      worktreePath?: string,
    ) {
      const service = getFilesystemOrThrow(projectId, worktreePath);

      try {
        return await service.listDir(path);
      } catch (error) {
        if (isNamedError(error, "PathTraversalError")) {
          throw new FileAccessError();
        }
        throw new FileReadError("Cannot read directory");
      }
    },

    async readProjectFile(
      projectId: string,
      path: string,
      worktreePath?: string,
    ) {
      const service = getFilesystemOrThrow(projectId, worktreePath);

      try {
        const content = await service.readFile(path);
        if (content === null) {
          throw new FileNotFoundError();
        }
        return content;
      } catch (error) {
        if (
          error instanceof FileNotFoundError ||
          error instanceof FileAccessError ||
          error instanceof FileTooLargeError
        ) {
          throw error;
        }
        if (isNamedError(error, "PathTraversalError")) {
          throw new FileAccessError();
        }
        if (error instanceof Error && error.message === "File too large") {
          throw new FileTooLargeError();
        }
        throw new FileReadError("Cannot read file");
      }
    },

    async writeProjectFile(
      projectId: string,
      path: string,
      content: string,
      worktreePath?: string,
    ): Promise<void> {
      if (isWritable && !isWritable(projectId)) {
        throw new FileWriteDisabledError();
      }
      const service = getFilesystemOrThrow(projectId, worktreePath);

      try {
        await service.writeFile(path, content);
      } catch (error) {
        if (isNamedError(error, "PathTraversalError")) {
          throw new FileAccessError();
        }
        if (error instanceof Error && error.message === "File too large") {
          throw new FileTooLargeError();
        }
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          throw new FileWriteError("Parent directory does not exist");
        }
        throw new FileWriteError("Cannot write file");
      }
    },

    async createProjectDirectory(
      projectId: string,
      path: string,
      worktreePath?: string,
    ): Promise<void> {
      if (isWritable && !isWritable(projectId)) {
        throw new FileWriteDisabledError();
      }
      const service = getFilesystemOrThrow(projectId, worktreePath);

      try {
        await service.mkdir(path);
      } catch (error) {
        if (isNamedError(error, "PathTraversalError")) {
          throw new FileAccessError();
        }
        throw new FileWriteError("Cannot create directory");
      }
    },

    async copyProjectEntry(
      projectId: string,
      srcPath: string,
      destPath: string,
      worktreePath?: string,
    ): Promise<void> {
      if (isWritable && !isWritable(projectId)) {
        throw new FileWriteDisabledError();
      }
      const service = getFilesystemOrThrow(projectId, worktreePath);

      try {
        await service.cp(srcPath, destPath);
      } catch (error) {
        if (isNamedError(error, "PathTraversalError")) {
          throw new FileAccessError();
        }
        if (isNamedError(error, "CopySourceNotFoundError")) {
          throw new FileNotFoundError("Source not found");
        }
        if (isNamedError(error, "CopyDestinationExistsError")) {
          throw new FileExistsError();
        }
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          throw new FileNotFoundError("Source not found");
        }
        if (
          error instanceof Error &&
          "code" in error &&
          (error as NodeJS.ErrnoException).code === "EEXIST"
        ) {
          throw new FileExistsError();
        }
        throw new FileWriteError("Cannot copy entry");
      }
    },
  };
}

function isNamedError(
  error: unknown,
  expectedName: string,
): error is Error & { name: string } {
  return error instanceof Error && error.name === expectedName;
}
