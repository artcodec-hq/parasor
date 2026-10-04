import { useEffect, useRef } from "react";
import type { OpenUrlOptions } from "../../../lib/open-url-options.js";

type OpenUrl = (url: string, options?: OpenUrlOptions) => void;

export function useTerminalOpenHandlerRefs({
  onOpenUrl,
  onOpenFilePath,
  projectId,
  worktreePath,
}: {
  onOpenUrl?: OpenUrl;
  onOpenFilePath?: (filePath: string) => void;
  projectId?: string;
  worktreePath?: string;
}) {
  const openUrlRef = useRef(onOpenUrl);
  const openFilePathRef = useRef(onOpenFilePath);
  const projectIdRef = useRef(projectId);
  const worktreePathRef = useRef(worktreePath);

  useEffect(() => {
    openUrlRef.current = onOpenUrl;
  }, [onOpenUrl]);

  useEffect(() => {
    openFilePathRef.current = onOpenFilePath;
  }, [onOpenFilePath]);

  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  useEffect(() => {
    worktreePathRef.current = worktreePath;
  }, [worktreePath]);

  return {
    openUrlRef,
    openFilePathRef,
    projectIdRef,
    worktreePathRef,
  };
}
