import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { authFetch } from "../../lib/auth-fetch.js";
import {
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  PaButton,
  type PaTabOption,
  PaTabs,
} from "../primitives/index.js";

interface FsEntry {
  name: string;
  path: string;
  type: "directory";
}

type Tab = "quick" | "browse" | "path";

export interface ProjectModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (path: string, name?: string) => void;
  focusedSessionCwd?: string | null;
  isMobile?: boolean;
}

function basename(path: string): string {
  return path.replace(/\/$/, "").split("/").pop() ?? path;
}

const PREFS_KEY = "parasor:projectLastFolder";

function loadLastFolder(): string {
  try {
    return localStorage.getItem(PREFS_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveLastFolder(folder: string): void {
  try {
    localStorage.setItem(PREFS_KEY, folder);
  } catch {
    // ignore
  }
}

export function ProjectModal({
  open,
  onClose,
  onCreate,
  isMobile = false,
}: ProjectModalProps) {
  const tabOptions = useMemo<PaTabOption<Tab>[]>(() => {
    const all: PaTabOption<Tab>[] = [
      { value: "quick", label: "Quick Pick" },
      { value: "browse", label: "Browse" },
      { value: "path", label: "Path" },
    ];
    return isMobile ? all.filter((o) => o.value !== "browse") : all;
  }, [isMobile]);

  const [tab, setTab] = useState<Tab>("quick");
  const [name, setName] = useState("");

  // Quick Pick: single source of truth = currently displayed folder.
  // The text input and the "..." breadcrumb both bind to `quickPath`.
  const [quickPath, setQuickPath] = useState("");
  const [quickInput, setQuickInput] = useState("");
  const [quickParent, setQuickParent] = useState<string | null>(null);
  const [quickEntries, setQuickEntries] = useState<FsEntry[]>([]);
  const [quickLoading, setQuickLoading] = useState(false);

  // Inline "create new folder" state for Quick Pick.
  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);

  // Browse tab state (OS native dialog)
  const [browsePath, setBrowsePath] = useState("");
  const [browseLoading, setBrowseLoading] = useState(false);

  // Path tab state
  const [manualPath, setManualPath] = useState("");
  const [pathValid, setPathValid] = useState<boolean | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pickFolder = useCallback(async () => {
    setBrowseLoading(true);
    try {
      const res = await authFetch("/api/fs/pick-folder", { method: "POST" });
      if (!res.ok) return;
      const data = (await res.json()) as { path?: string; cancelled?: boolean };
      if (data.path) setBrowsePath(data.path);
    } catch {
      // ignore
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const fetchQuickEntries = useCallback(async (path?: string) => {
    setQuickLoading(true);
    try {
      const url = path
        ? `/api/fs/browse?path=${encodeURIComponent(path)}`
        : "/api/fs/browse";
      const res = await authFetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as {
        path: string;
        parent: string | null;
        entries: FsEntry[];
      };
      setQuickEntries(data.entries ?? []);
      setQuickPath(data.path);
      setQuickInput(data.path);
      setQuickParent(data.parent);
      saveLastFolder(data.path);
    } catch {
      // ignore
    } finally {
      setQuickLoading(false);
    }
  }, []);

  // Load quick entries on open. Resume the last folder the user navigated to.
  useEffect(() => {
    if (open && tab === "quick" && quickPath === "") {
      fetchQuickEntries(loadLastFolder() || undefined);
    }
  }, [open, tab, quickPath, fetchQuickEntries]);

  // Reset on modal open
  useEffect(() => {
    if (!open) return;
    setTab("quick");
    setName("");
    setManualPath("");
    setPathValid(null);
    setBrowsePath("");
    setQuickPath("");
    setQuickInput("");
    setQuickParent(null);
    setCreating(false);
    setNewFolderName("");
    setCreateBusy(false);
    setCreateError(null);
  }, [open]);

  // Manual edit of the folder input -- debounce navigate.
  const handleQuickInputChange = (v: string) => {
    setQuickInput(v);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchQuickEntries(v.trim() || undefined);
    }, 300);
  };

  const validatePath = useCallback((path: string) => {
    if (!path.trim()) {
      setPathValid(null);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await authFetch(
          `/api/fs/browse?path=${encodeURIComponent(path.trim())}`,
        );
        setPathValid(res.ok);
      } catch {
        setPathValid(false);
      }
    }, 300);
  }, []);

  const handlePathChange = (v: string) => {
    setManualPath(v);
    validatePath(v);
  };

  const resolvedName = (selectedPath: string) =>
    name.trim() || basename(selectedPath);

  const handleCreate = (selectedPath: string) => {
    if (!selectedPath) return;
    onCreate(selectedPath, resolvedName(selectedPath) || undefined);
    onClose();
  };

  const submitNewFolder = async () => {
    const trimmed = newFolderName.trim();
    if (!trimmed || !quickPath || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await authFetch("/api/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: quickPath, name: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setCreateError(data.error ?? "Failed to create folder");
        return;
      }
      const data = (await res.json()) as { path: string };
      handleCreate(data.path);
    } catch {
      setCreateError("Failed to create folder");
    } finally {
      setCreateBusy(false);
    }
  };

  const cancelCreate = () => {
    setCreating(false);
    setNewFolderName("");
    setCreateError(null);
  };

  useEffect(() => {
    if (creating)
      requestAnimationFrame(() => newFolderInputRef.current?.focus());
  }, [creating]);

  const newFolderTrim = newFolderName.trim();
  const canSubmitNew =
    !createBusy &&
    newFolderTrim.length > 0 &&
    !newFolderTrim.includes("/") &&
    newFolderTrim !== "." &&
    newFolderTrim !== "..";
  const submitAction =
    tab === "quick" ? (
      <DialogButton
        variant="primary"
        disabled={!quickPath || creating}
        onClick={() => handleCreate(quickPath)}
      >
        {quickPath ? `Add "${basename(quickPath)}"` : "Add this folder"}
      </DialogButton>
    ) : tab === "browse" ? (
      <DialogButton
        variant="primary"
        disabled={!browsePath}
        onClick={() => handleCreate(browsePath)}
      >
        {browsePath ? `Add "${basename(browsePath)}"` : "Add this folder"}
      </DialogButton>
    ) : (
      <DialogButton
        variant="primary"
        disabled={!pathValid}
        onClick={() => handleCreate(manualPath.trim())}
      >
        {manualPath.trim()
          ? `Add "${basename(manualPath.trim())}"`
          : "Add this folder"}
      </DialogButton>
    );

  return (
    <DialogRoot
      open={open}
      ariaLabel="New Project"
      onClose={onClose}
      presentation={isMobile ? "sheet" : "modal"}
      widthClassName="max-w-md"
      panelClassName="flex max-h-[80vh] flex-col"
    >
      <DialogHeader title="New Project" onClose={onClose} />

      <PaTabs value={tab} options={tabOptions} onChange={setTab} />

      <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4">
        {tab === "quick" && (
          <div className="space-y-3">
            <div>
              <label
                htmlFor="project-quick-folder"
                className="mb-1 block text-xs text-text-secondary"
              >
                Folder
              </label>
              <input
                id="project-quick-folder"
                type="text"
                value={quickInput}
                onChange={(e) => handleQuickInputChange(e.target.value)}
                placeholder="~/projects"
                className="w-full rounded-control border border-border bg-bg-primary px-3 py-1.5 text-xs text-text-primary outline-none font-mono focus:ring-1 focus:ring-accent"
              />
            </div>
            {quickLoading ? (
              <p className="text-xs text-text-secondary">Loading…</p>
            ) : (
              <div className="rounded-control border border-border overflow-hidden max-h-64 overflow-y-auto">
                {quickParent && (
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-xs text-text-secondary hover:bg-bg-primary/50"
                    onClick={() => fetchQuickEntries(quickParent)}
                  >
                    <span className="mr-2">↑</span>..
                  </button>
                )}
                {quickEntries.map((e) => (
                  <button
                    type="button"
                    key={e.path}
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-text-primary hover:bg-bg-primary/50"
                    onClick={() => fetchQuickEntries(e.path)}
                  >
                    <span className="text-text-secondary">📁</span>
                    <span className="flex-1 truncate">{e.name}</span>
                    <span className="text-text-secondary">›</span>
                  </button>
                ))}
                {quickEntries.length === 0 && !quickParent && (
                  <p className="px-3 py-2 text-xs text-text-secondary">
                    No subdirectories found
                  </p>
                )}
                {quickEntries.length === 0 && quickParent && (
                  <p className="px-3 py-2 text-xs text-text-secondary">
                    Empty -- use the button below to add this folder
                  </p>
                )}
              </div>
            )}

            {/* Create new folder affordance (Quick Pick only) */}
            {creating ? (
              <div className="rounded-control border border-border bg-bg-primary p-3 space-y-2">
                <label
                  htmlFor="project-new-folder-name"
                  className="block text-xs text-text-secondary"
                >
                  New folder name
                </label>
                <input
                  ref={newFolderInputRef}
                  id="project-new-folder-name"
                  type="text"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && canSubmitNew) {
                      e.preventDefault();
                      void submitNewFolder();
                    }
                  }}
                  placeholder="my-new-app"
                  disabled={createBusy}
                  className="w-full rounded-control border border-border bg-bg-secondary px-3 py-1.5 text-xs text-text-primary outline-none font-mono focus:ring-1 focus:ring-accent"
                />
                <p className="truncate text-xs text-text-secondary font-mono">
                  {quickPath
                    ? `${quickPath.replace(/\/$/, "")}/${newFolderTrim || "…"}`
                    : "Pick a parent folder first"}
                </p>
                {createError && (
                  <p className="text-xs text-danger">{createError}</p>
                )}
                <div className="flex justify-end gap-2 pt-1">
                  <PaButton kind="normal" onClick={cancelCreate}>
                    Cancel
                  </PaButton>
                  <PaButton
                    kind="submit"
                    disabled={!canSubmitNew || !quickPath}
                    onClick={() => void submitNewFolder()}
                  >
                    {createBusy ? "Creating…" : "Create"}
                  </PaButton>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCreating(true);
                  setCreateError(null);
                }}
                disabled={!quickPath || quickLoading}
                className="w-full rounded-control border border-dashed border-border bg-bg-primary px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-primary/70 disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <span>+</span>
                <span>Create new folder here</span>
              </button>
            )}
          </div>
        )}

        {tab === "browse" && (
          <div className="space-y-3">
            <p className="text-xs text-text-secondary">
              OS
              のフォルダ選択ダイアログでプロジェクトディレクトリを選択します。
            </p>
            <button
              type="button"
              onClick={pickFolder}
              disabled={browseLoading}
              className="w-full rounded-control border border-border bg-bg-primary px-4 py-3 text-sm text-text-primary hover:bg-bg-primary/50 disabled:opacity-40"
            >
              {browseLoading ? "Waiting for dialog..." : "Open Folder Picker"}
            </button>
            {browsePath && (
              <div className="rounded-control bg-bg-primary px-3 py-2 text-xs font-mono text-text-primary break-all">
                {browsePath}
              </div>
            )}
          </div>
        )}

        {tab === "path" && (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="/absolute/path/to/project"
              value={manualPath}
              onChange={(e) => handlePathChange(e.target.value)}
              className={`w-full rounded-control border px-3 py-1.5 text-sm bg-bg-primary text-text-primary outline-none font-mono ${
                pathValid === true
                  ? "border-success"
                  : pathValid === false
                    ? "border-danger"
                    : "border-border"
              }`}
            />
            {pathValid === true && (
              <p className="text-xs text-success">Valid directory</p>
            )}
            {pathValid === false && (
              <p className="text-xs text-danger">Directory not found</p>
            )}
          </div>
        )}

        {/* Shared name field */}
        <div>
          <label
            htmlFor="project-name"
            className="mb-1 block text-xs text-text-secondary"
          >
            Project name (optional)
          </label>
          <input
            id="project-name"
            type="text"
            placeholder={
              tab === "quick" && quickPath
                ? basename(quickPath)
                : tab === "browse" && browsePath
                  ? basename(browsePath)
                  : tab === "path" && manualPath
                    ? basename(manualPath)
                    : "auto-detected"
            }
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-control border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none"
          />
        </div>
      </div>

      <div className="min-w-0 border-t border-border px-4 py-3">
        <DialogFooter layout={isMobile ? "stack" : "end"}>
          {isMobile ? (
            <>
              {submitAction}
              <DialogButton onClick={onClose}>Cancel</DialogButton>
            </>
          ) : (
            <>
              <DialogButton onClick={onClose}>Cancel</DialogButton>
              {submitAction}
            </>
          )}
        </DialogFooter>
      </div>
    </DialogRoot>
  );
}
