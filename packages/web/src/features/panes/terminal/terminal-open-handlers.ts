import type { RefObject } from "react";
import { openHttpUrlInNewTab } from "../../../lib/open-external-url.js";
import type { OpenUrlOptions } from "../../../lib/open-url-options.js";
import { shouldOpenInEmbeddedBrowser } from "../../../lib/url-routing.js";

type OpenUrl = (url: string, options?: OpenUrlOptions) => void;

export function createTerminalOpenHandlers({
  openUrlRef,
  openFilePathRef,
  projectIdRef,
  worktreePathRef,
}: {
  openUrlRef: RefObject<OpenUrl | undefined>;
  openFilePathRef: RefObject<((filePath: string) => void) | undefined>;
  projectIdRef: RefObject<string | undefined>;
  worktreePathRef: RefObject<string | undefined>;
}) {
  return {
    openUrl: (uri: string) => {
      const openUrl = openUrlRef.current;
      if (openUrl && shouldOpenInEmbeddedBrowser(uri)) {
        const terminalProjectId = projectIdRef.current;
        if (terminalProjectId) {
          openUrl(uri, { projectId: terminalProjectId });
        } else {
          openUrl(uri);
        }
      } else {
        openHttpUrlInNewTab(uri);
      }
    },
    openFilePath: (filePath: string) => {
      openFilePathRef.current?.(filePath);
    },
    getWorktreePath: () => worktreePathRef.current,
  };
}
