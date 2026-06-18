import { openSearchPanel } from "@codemirror/search";
import type { EditorView } from "@codemirror/view";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorKeyBar } from "../../../components/mobile/EditorKeyBar.js";
import {
  PaGlyph,
  PaneHeader,
  PaneIconButton,
} from "../../../components/primitives/index.js";
import { useVirtualKeyboard } from "../../../hooks/useVirtualKeyboard.js";
import { getFileIconComponent } from "../../../lib/file-icons.js";
import { readFile, writeFile } from "../../../lib/files-api.js";
import { getMediaKindFromName } from "../../../lib/media-types.js";
import { basename, dirname, extname } from "../../../lib/path.js";
import { useProject } from "../../workspace/projects-context.js";
import { FileEditor } from "./FileEditor.js";
import { MarkdownPreview } from "./MarkdownPreview.js";
import { MediaPreviewPane } from "./MediaPreviewPane.js";

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdx"]);

type ViewMode = "source" | "preview";
interface LoadOptions {
  preserveLoaded?: boolean;
}

/**
 * True on touch-primary devices. Mirrors Terminal.tsx: only render the
 * EditorKeyBar when the user lacks a physical keyboard with Esc/Tab/arrows.
 */
const isTouchDevice = (): boolean => {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(pointer: coarse)").matches ?? false;
};

type LoadStatus = "idle" | "loading" | "loaded" | "error";

interface EditorPaneProps {
  paneId: string;
  projectId: string;
  /**
   * Worktree root the editor's file path is relative to. Threads through
   * to `/api/files/{read,write}?worktreePath=...` so an editor opened
   * from worktree A reads from A's tree, not the project main checkout.
   * `undefined` falls back to project root (legacy behavior).
   */
  worktreePath?: string;
  filePath: string;
  fileChangeSeq?: number;
  onClose?: () => void;
}

export function EditorPane(props: EditorPaneProps) {
  // Pick preview vs text-editor at the very top level. Each branch uses its
  // own hook stack -- keeping them in a single component would mean calling
  // text-editor hooks while previewing a media file (rules-of-hooks
  // violation when `filePath` switches kind mid-mount).
  const mediaKind = getMediaKindFromName(basename(props.filePath));
  if (mediaKind) {
    return (
      <MediaPreviewPane
        paneId={props.paneId}
        projectId={props.projectId}
        worktreePath={props.worktreePath}
        filePath={props.filePath}
        kind={mediaKind}
        fileChangeSeq={props.fileChangeSeq}
        onClose={props.onClose}
      />
    );
  }
  return <TextEditorPane {...props} />;
}

function TextEditorPane({
  projectId,
  worktreePath,
  filePath,
  fileChangeSeq,
  onClose,
}: EditorPaneProps) {
  const project = useProject(projectId);
  const readOnly = !!project?.readOnly;
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [original, setOriginal] = useState<string>("");
  const [value, setValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [view, setView] = useState<EditorView | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("source");
  const [isTouch] = useState(() => isTouchDevice());
  const { height: kbHeight } = useVirtualKeyboard();
  const valueRef = useRef(value);
  valueRef.current = value;
  const statusRef = useRef(status);
  statusRef.current = status;
  // Holds the controller for the currently-active load(). Each new load()
  // aborts the previous one so a stale fetch (e.g. from the file the user
  // just navigated away from) cannot resolve last and overwrite fresh
  // content. The retry loop's setTimeout is also aborted via this signal,
  // and the catch branch swallows AbortError so superseded loads stay
  // silent.
  const loadAbortRef = useRef<AbortController | null>(null);

  const load = useCallback(
    async (options: LoadOptions = {}) => {
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      const { signal } = controller;
      const preserveLoaded =
        options.preserveLoaded === true && statusRef.current === "loaded";
      if (!preserveLoaded) setStatus("loading");
      setErrorMessage(null);

      // 502/503/504 only come from the dev/prod reverse proxy when the
      // upstream is briefly unreachable (e.g. branch switch fires a burst
      // of @parcel/watcher events that delay the server). Hono itself
      // never emits these. Retry with backoff so a proxy blip during
      // fileChangeSeq-driven reload doesn't park the pane in an error
      // state.
      const PROXY_BLIP_STATUSES = new Set([502, 503, 504]);
      const RETRY_DELAYS_MS = [500, 1500];

      for (let attempt = 0; ; attempt++) {
        try {
          const res = await readFile(
            { projectId, path: filePath, worktreePath },
            signal,
          );
          if (signal.aborted) return;
          if (!res.ok) {
            if (
              PROXY_BLIP_STATUSES.has(res.status) &&
              attempt < RETRY_DELAYS_MS.length
            ) {
              await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, RETRY_DELAYS_MS[attempt]);
                signal.addEventListener(
                  "abort",
                  () => {
                    clearTimeout(t);
                    reject(new DOMException("aborted", "AbortError"));
                  },
                  { once: true },
                );
              });
              continue;
            }
            const body = await res.text();
            if (signal.aborted) return;
            setStatus("error");
            setErrorMessage(body || `HTTP ${res.status}`);
            return;
          }
          const text = await res.text();
          if (signal.aborted) return;
          if (preserveLoaded && text === valueRef.current) return;
          setOriginal(text);
          setValue(text);
          setStatus("loaded");
          return;
        } catch (err) {
          if (signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setStatus("error");
          setErrorMessage(err instanceof Error ? err.message : String(err));
          return;
        }
      }
    },
    [projectId, filePath, worktreePath],
  );

  useEffect(() => {
    void load();
    return () => loadAbortRef.current?.abort();
  }, [load]);

  const dirty = status === "loaded" && value !== original;

  const save = useCallback(async () => {
    if (readOnly || saving) return;
    setSaving(true);
    setSaveError(null);
    const snapshot = valueRef.current;
    try {
      const res = await writeFile({
        projectId,
        path: filePath,
        content: snapshot,
        ...(worktreePath ? { worktreePath } : {}),
      });
      if (!res.ok) {
        const body = await res.text();
        setSaveError(body || `HTTP ${res.status}`);
        return;
      }
      setOriginal(snapshot);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }, [projectId, filePath, saving, readOnly, worktreePath]);

  const revert = useCallback(() => {
    if (!dirty) return;
    setValue(original);
    setSaveError(null);
  }, [dirty, original]);

  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (fileChangeSeq === undefined || fileChangeSeq === 0) return;
    if (dirty) return;
    void load({ preserveLoaded: true });
  }, [fileChangeSeq, dirty, load]);

  const fileName = basename(filePath);
  const fileDir = dirname(filePath);
  const FileIcon = useMemo(() => getFileIconComponent(fileName), [fileName]);
  const isMarkdown = MARKDOWN_EXTS.has(extname(filePath));
  const previewActive = isMarkdown && viewMode === "preview";

  // Reset to source mode when navigating to a non-md file so the toggle
  // never strands a non-md buffer in preview mode.
  useEffect(() => {
    if (!isMarkdown && viewMode !== "source") setViewMode("source");
  }, [isMarkdown, viewMode]);

  const keyboardOpen = kbHeight > 0;
  const handleKeyboardToggle = useCallback(() => {
    if (!view) return;
    // Prefer activeElement over visualViewport: iOS Safari inside PWAs /
    // iframes sometimes skips the resize event, which leaves `keyboardOpen`
    // falsely at `false` and sends the toggle down the focus branch (so
    // tapping ⌨ while the keyboard is up does nothing). Mirrors the same
    // workaround in Terminal.tsx:545-561.
    const isFocused = document.activeElement === view.contentDOM;
    if (isFocused || keyboardOpen) {
      view.contentDOM.blur();
    } else {
      view.contentDOM.focus();
    }
  }, [view, keyboardOpen]);
  const showKeyBar = isTouch && status === "loaded" && !readOnly;

  return (
    <div
      className="flex h-full flex-col bg-bg-primary text-text-primary"
      style={kbHeight > 0 ? { paddingBottom: kbHeight } : undefined}
    >
      <PaneHeader
        icon={<FileIcon className="h-icon-base w-icon-base" />}
        title={fileName}
        titleAttr={fileName}
        titleAdornment={
          readOnly ? (
            <span
              className="shrink-0 text-danger"
              title="Read-only"
              role="img"
              aria-label="Read-only"
            >
              <PaGlyph.readOnlyFile />
            </span>
          ) : dirty ? (
            <span
              className="shrink-0 text-warning"
              title="Has unsaved changes"
              role="img"
              aria-label="Modified"
            >
              <PaGlyph.modified />
            </span>
          ) : undefined
        }
        subtitle={fileDir || undefined}
        subtitleAttr={filePath}
        actions={
          <div className="flex shrink-0 items-center gap-1">
            {isMarkdown && (
              <PaneIconButton
                onClick={() =>
                  setViewMode((m) => (m === "preview" ? "source" : "preview"))
                }
                label={previewActive ? "Show source" : "Show preview"}
                pressed={previewActive}
                title={previewActive ? "Show source" : "Show preview"}
                tone={previewActive ? "active" : "normal"}
                className={previewActive ? "bg-row-hover-bg" : undefined}
              >
                {previewActive ? <PaGlyph.eyeOff /> : <PaGlyph.eye />}
              </PaneIconButton>
            )}
            <PaneIconButton
              onClick={() => {
                if (view) openSearchPanel(view);
              }}
              disabled={!view || previewActive}
              label="Find"
              title="Find"
            >
              <PaGlyph.search />
            </PaneIconButton>
            {!readOnly && (
              <>
                <PaneIconButton
                  onClick={revert}
                  disabled={!dirty || saving}
                  label="Revert"
                  title="Revert"
                >
                  <PaGlyph.revert />
                </PaneIconButton>
                <PaneIconButton
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  label={saving ? "Saving" : "Save"}
                  title={saving ? "Saving…" : "Save"}
                >
                  <PaGlyph.save />
                </PaneIconButton>
              </>
            )}
            {onClose && (
              <PaneIconButton onClick={onClose} label="Close file preview">
                <PaGlyph.close />
              </PaneIconButton>
            )}
          </div>
        }
      />

      {saveError && (
        <div
          className="cm-mono shrink-0 truncate border-b border-danger/40 bg-danger/10 px-3 py-1.5 text-xs text-danger"
          title={saveError}
        >
          Save failed: {saveError}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {status === "loading" && (
          <div className="p-3 text-sm text-text-secondary">Loading…</div>
        )}
        {status === "error" && (
          <div className="p-3 text-sm text-red-400">
            Failed to load: {errorMessage}
          </div>
        )}
        {status === "loaded" && previewActive && (
          <MarkdownPreview value={value} />
        )}
        {status === "loaded" && !previewActive && (
          <FileEditor
            value={value}
            filePath={filePath}
            readOnly={readOnly}
            onChange={setValue}
            onSave={() => void save()}
            onCreateEditor={setView}
          />
        )}
      </div>

      {showKeyBar && !previewActive && (
        <EditorKeyBar
          view={view}
          keyboardOpen={keyboardOpen}
          onKeyboardToggle={handleKeyboardToggle}
        />
      )}
    </div>
  );
}
