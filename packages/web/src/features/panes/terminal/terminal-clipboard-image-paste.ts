import type { MutableRefObject } from "react";
import { extractImageFiles } from "../../../lib/clipboard-images.js";

type AttachTerminalClipboardImagePasteArgs = {
  textarea: HTMLTextAreaElement | undefined;
  dropEnabledRef: MutableRefObject<boolean>;
  runUploadRef: MutableRefObject<(files: readonly File[]) => Promise<void>>;
};

export function attachTerminalClipboardImagePaste({
  textarea,
  dropEnabledRef,
  runUploadRef,
}: AttachTerminalClipboardImagePasteArgs): () => void {
  // Clipboard image paste: when the user hits Cmd+V / Ctrl+V inside xterm and
  // the clipboard carries image data, upload via the same drops endpoint as
  // OS-file DnD and inject the returned absolute paths. Text-only paste falls
  // through to xterm's default handling untouched.
  const onPaste = (event: ClipboardEvent): void => {
    if (!dropEnabledRef.current) return;
    const images = extractImageFiles(event.clipboardData);
    if (images.length === 0) return;
    event.preventDefault();
    void runUploadRef.current(images);
  };

  textarea?.addEventListener("paste", onPaste);
  return () => {
    textarea?.removeEventListener("paste", onPaste);
  };
}
