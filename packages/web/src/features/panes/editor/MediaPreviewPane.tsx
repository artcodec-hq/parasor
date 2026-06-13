import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PaGlyph, PaneHeader } from "../../../components/primitives/index.js";
import { getFileIconComponent } from "../../../lib/file-icons.js";
import { statFile } from "../../../lib/files-api.js";
import type { MediaKind } from "../../../lib/media-types.js";
import { basename, dirname } from "../../../lib/path.js";

/**
 * Files larger than this trigger an explicit "Open anyway" gate so a tap on
 * a 200 MB video doesn't silently saturate a phone connection. Below the
 * gate we render immediately. Server side has its own 50 MB hard cap (see
 * `MAX_MEDIA_BYTES` in routes/files.ts).
 */
const SOFT_SIZE_LIMIT_BYTES = 25 * 1024 * 1024;

interface MediaPreviewPaneProps {
  paneId: string;
  projectId: string;
  worktreePath?: string;
  filePath: string;
  kind: MediaKind;
  fileChangeSeq?: number;
}

interface StatResponse {
  size: number;
  mtimeMs: number;
  isFile: boolean;
}

type LoadStatus = "idle" | "checking" | "ready" | "gated" | "error";

function buildRawUrl(
  projectId: string,
  filePath: string,
  worktreePath: string | undefined,
  cacheBuster: number,
): string {
  const params = new URLSearchParams({
    projectId,
    path: filePath,
  });
  if (worktreePath) params.set("worktreePath", worktreePath);
  if (cacheBuster) params.set("v", String(cacheBuster));
  return `/api/files/raw?${params.toString()}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function MediaPreviewPane({
  projectId,
  worktreePath,
  filePath,
  kind,
  fileChangeSeq,
}: MediaPreviewPaneProps) {
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [size, setSize] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [overrideGate, setOverrideGate] = useState(false);
  // Aborts the in-flight stat fetch when filePath/worktreePath change so a
  // slow stat for the previous file cannot resolve last and overwrite state
  // for the file currently displayed (mirrors EditorPane's load() pattern).
  const statAbortRef = useRef<AbortController | null>(null);

  const fileName = basename(filePath);
  const fileDir = dirname(filePath);
  const FileIcon = useMemo(() => getFileIconComponent(fileName), [fileName]);

  // overrideGate is per-file: clearing on filePath/worktreePath change keeps
  // the soft-size warning from being silently bypassed when the user opens
  // a different large file in the same pane.
  const fileScopeKey = `${worktreePath}\n${filePath}`;
  useEffect(() => {
    void fileScopeKey;
    setOverrideGate(false);
  }, [fileScopeKey]);

  const checkStat = useCallback(async () => {
    statAbortRef.current?.abort();
    const controller = new AbortController();
    statAbortRef.current = controller;
    const { signal } = controller;
    setStatus("checking");
    setErrorMessage(null);
    try {
      const res = await statFile(
        { projectId, path: filePath, worktreePath },
        signal,
      );
      if (signal.aborted) return;
      if (!res.ok) {
        setStatus("error");
        setErrorMessage(`HTTP ${res.status}`);
        return;
      }
      const body = (await res.json()) as StatResponse;
      if (signal.aborted) return;
      setSize(body.size);
      if (body.size > SOFT_SIZE_LIMIT_BYTES && !overrideGate) {
        setStatus("gated");
        return;
      }
      setStatus("ready");
    } catch (err) {
      if (signal.aborted) return;
      if (err instanceof DOMException && err.name === "AbortError") return;
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, [projectId, filePath, worktreePath, overrideGate]);

  useEffect(() => {
    void fileChangeSeq;
    void checkStat();
    return () => statAbortRef.current?.abort();
  }, [checkStat, fileChangeSeq]);

  const cacheBuster = fileChangeSeq ?? 0;
  const rawUrl = buildRawUrl(projectId, filePath, worktreePath, cacheBuster);

  const onConfirmOpen = useCallback(() => {
    setOverrideGate(true);
    setStatus("ready");
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg-primary text-text-primary">
      <PaneHeader
        icon={<FileIcon className="h-icon-base w-icon-base" />}
        title={fileName}
        titleAttr={fileName}
        titleAdornment={
          <span
            className="shrink-0 text-text-secondary"
            title="Read-only preview"
            role="img"
            aria-label="Read-only"
          >
            <PaGlyph.readOnlyFile />
          </span>
        }
        subtitle={fileDir || undefined}
        subtitleAttr={filePath}
      />

      <div className="min-h-0 flex-1 overflow-auto">
        {status === "idle" || status === "checking" ? (
          <div className="p-3 text-sm text-text-secondary">Loading…</div>
        ) : status === "error" ? (
          <div className="p-3 text-sm text-danger">
            Failed to load: {errorMessage}
          </div>
        ) : status === "gated" ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
            <div className="text-text-secondary">
              This file is large (
              {size !== null ? formatBytes(size) : "unknown size"}).
            </div>
            <button
              type="button"
              onClick={onConfirmOpen}
              className="rounded-control bg-accent px-3 py-1.5 text-text-primary hover:bg-accent/90"
            >
              Open anyway
            </button>
          </div>
        ) : (
          <MediaSurface kind={kind} src={rawUrl} alt={fileName} />
        )}
      </div>
    </div>
  );
}

interface MediaSurfaceProps {
  kind: MediaKind;
  src: string;
  alt: string;
}

function MediaSurface({ kind, src, alt }: MediaSurfaceProps) {
  // `touch-pan-x touch-pan-y touch-pinch-zoom` lets mobile browsers handle
  // pinch zoom natively without us re-implementing gesture state. Tailwind
  // utilities only -- inline `style` is forbidden by project rules.
  if (kind === "image") {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto">
        <img
          src={src}
          alt={alt}
          draggable={false}
          className="max-h-full max-w-full object-contain touch-pinch-zoom"
        />
      </div>
    );
  }
  if (kind === "video") {
    return (
      <div className="flex h-full w-full items-center justify-center bg-black">
        {/* biome-ignore lint/a11y/useMediaCaption: user content; we have no caption track to point at */}
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          className="max-h-full max-w-full"
        />
      </div>
    );
  }
  if (kind === "audio") {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        {/* biome-ignore lint/a11y/useMediaCaption: user content; we have no caption track to point at */}
        <audio
          src={src}
          controls
          preload="metadata"
          className="w-full max-w-md"
        />
      </div>
    );
  }
  if (
    typeof navigator !== "undefined" &&
    navigator.pdfViewerEnabled === false
  ) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm">
        <div className="text-text-secondary">
          PDF preview is unavailable in this browser.
        </div>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          className="rounded-control bg-accent px-3 py-1.5 text-text-primary hover:bg-accent/90"
        >
          Open PDF
        </a>
      </div>
    );
  }
  return (
    <iframe
      src={src}
      title={alt}
      className="h-full w-full border-0 bg-bg-primary"
    />
  );
}
