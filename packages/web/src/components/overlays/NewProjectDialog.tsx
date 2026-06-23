import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "../../lib/auth-fetch.js";
import {
  DialogButton,
  DialogFooter,
  DialogHeader,
  DialogRoot,
  PaButton,
  PaGlyph,
} from "../primitives/index.js";

interface FsEntry {
  name: string;
  path: string;
  type: "directory";
}

export interface NewProjectDialogProps {
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

export function NewProjectDialog({
  open,
  onClose,
  onCreate,
  isMobile = false,
}: NewProjectDialogProps) {
  const [name, setName] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [folderInput, setFolderInput] = useState("");
  const [folderParent, setFolderParent] = useState<string | null>(null);
  const [folderEntries, setFolderEntries] = useState<FsEntry[]>([]);
  const [folderLoading, setFolderLoading] = useState(false);
  const [folderValid, setFolderValid] = useState<boolean | null>(null);
  const [folderError, setFolderError] = useState<string | null>(null);
  const [pickerLoading, setPickerLoading] = useState(false);

  const [creating, setCreating] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newFolderInputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFolder = useCallback(async (path?: string) => {
    setFolderLoading(true);
    setFolderError(null);
    try {
      const url = path
        ? `/api/fs/browse?path=${encodeURIComponent(path)}`
        : "/api/fs/browse";
      const res = await authFetch(url);
      if (!res.ok) {
        setFolderPath("");
        setFolderEntries([]);
        setFolderParent(null);
        setFolderValid(false);
        setFolderError("Directory not found");
        return;
      }
      const data = (await res.json()) as {
        path: string;
        parent: string | null;
        entries: FsEntry[];
      };
      setFolderEntries(data.entries ?? []);
      setFolderPath(data.path);
      setFolderInput(data.path);
      setFolderParent(data.parent);
      setFolderValid(true);
      saveLastFolder(data.path);
    } catch {
      setFolderPath("");
      setFolderEntries([]);
      setFolderParent(null);
      setFolderValid(false);
      setFolderError("Directory not found");
    } finally {
      setFolderLoading(false);
    }
  }, []);

  const pickFolder = useCallback(async () => {
    setPickerLoading(true);
    setFolderError(null);
    try {
      const res = await authFetch("/api/fs/pick-folder", { method: "POST" });
      if (!res.ok) {
        setFolderError("Folder picker is unavailable");
        return;
      }
      const data = (await res.json()) as { path?: string; cancelled?: boolean };
      if (data.path) await fetchFolder(data.path);
    } catch {
      setFolderError("Folder picker is unavailable");
    } finally {
      setPickerLoading(false);
    }
  }, [fetchFolder]);

  useEffect(() => {
    if (open && folderInput === "" && folderPath === "") {
      void fetchFolder(loadLastFolder() || undefined);
    }
  }, [fetchFolder, folderInput, folderPath, open]);

  useEffect(() => {
    if (!open) return;
    setName("");
    setFolderPath("");
    setFolderInput("");
    setFolderParent(null);
    setFolderEntries([]);
    setFolderValid(null);
    setFolderError(null);
    setPickerLoading(false);
    setCreating(false);
    setNewFolderName("");
    setCreateBusy(false);
    setCreateError(null);
  }, [open]);

  const handleFolderInputChange = (value: string) => {
    setFolderInput(value);
    setFolderValid(null);
    setFolderError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchFolder(value.trim() || undefined);
    }, 300);
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
    if (!trimmed || !folderPath || createBusy) return;
    setCreateBusy(true);
    setCreateError(null);
    try {
      const res = await authFetch("/api/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent: folderPath, name: trimmed }),
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
  const canAddProject =
    !creating && folderValid === true && folderPath.length > 0;
  const submitAction = (
    <DialogButton
      variant="primary"
      disabled={!canAddProject}
      onClick={() => handleCreate(folderPath)}
    >
      {folderPath ? `Add "${basename(folderPath)}"` : "Add project"}
    </DialogButton>
  );

  return (
    <DialogRoot
      open={open}
      ariaLabel="New project"
      onClose={onClose}
      presentation={isMobile ? "fullscreen" : "modal"}
      widthClassName="max-w-md"
      panelClassName={`flex flex-col ${isMobile ? "min-h-0" : "max-h-[80vh]"}`}
    >
      <DialogHeader title="New project" onClose={onClose} />

      <div className="min-w-0 flex-1 space-y-3 overflow-y-auto p-4">
        <div>
          <label
            htmlFor="project-folder"
            className="mb-1 block text-xs text-text-secondary"
          >
            Project folder
          </label>
          <div className="flex min-w-0 items-center gap-2">
            <input
              id="project-folder"
              type="text"
              value={folderInput}
              onChange={(e) => handleFolderInputChange(e.target.value)}
              placeholder="~/projects/my-app"
              className={`min-w-0 flex-1 rounded-control border bg-bg-primary px-3 py-1.5 text-xs text-text-primary outline-none font-mono focus:ring-1 focus:ring-accent ${
                folderValid === false
                  ? "border-danger"
                  : folderValid === true
                    ? "border-success"
                    : "border-border"
              }`}
            />
            <button
              type="button"
              onClick={() => void pickFolder()}
              disabled={pickerLoading}
              aria-label="Choose folder"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-border bg-bg-primary text-text-secondary hover:bg-row-hover-bg hover:text-text-primary disabled:opacity-40"
            >
              <PaGlyph.folder />
            </button>
          </div>
          {folderError && (
            <p className="mt-1 text-xs text-danger">{folderError}</p>
          )}
        </div>

        {folderLoading ? (
          <p className="text-xs text-text-secondary">Loading...</p>
        ) : (
          <div className="rounded-control border border-border overflow-hidden max-h-64 overflow-y-auto">
            {folderParent && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary hover:bg-bg-primary/50"
                onClick={() => void fetchFolder(folderParent)}
              >
                <PaGlyph.back />
                <span>Parent folder</span>
              </button>
            )}
            {folderEntries.map((entry) => (
              <button
                type="button"
                key={entry.path}
                className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-text-primary hover:bg-bg-primary/50"
                onClick={() => void fetchFolder(entry.path)}
              >
                <span className="text-text-secondary">
                  <PaGlyph.folder />
                </span>
                <span className="flex-1 truncate">{entry.name}</span>
                <span className="text-text-secondary">
                  <PaGlyph.disclosure />
                </span>
              </button>
            ))}
            {folderEntries.length === 0 && !folderParent && (
              <p className="px-3 py-2 text-xs text-text-secondary">
                No subdirectories found
              </p>
            )}
            {folderEntries.length === 0 && folderParent && (
              <p className="px-3 py-2 text-xs text-text-secondary">
                Empty -- use the button below to add this folder
              </p>
            )}
          </div>
        )}

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
              {folderPath
                ? `${folderPath.replace(/\/$/, "")}/${newFolderTrim || "..."}`
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
                disabled={!canSubmitNew || !folderPath}
                onClick={() => void submitNewFolder()}
              >
                {createBusy ? "Creating..." : "Create"}
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
            disabled={!folderPath || folderLoading}
            className="w-full rounded-control border border-dashed border-border bg-bg-primary px-3 py-2 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-primary/70 disabled:opacity-40 flex items-center justify-center gap-2"
          >
            <PaGlyph.add />
            <span>New folder here</span>
          </button>
        )}

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
            placeholder={folderPath ? basename(folderPath) : "auto-detected"}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-control border border-border bg-bg-primary px-3 py-1.5 text-sm text-text-primary outline-none"
          />
        </div>
      </div>

      <div className="min-w-0 shrink-0 border-t border-border px-4 py-3">
        <DialogFooter>
          <DialogButton onClick={onClose}>Cancel</DialogButton>
          {submitAction}
        </DialogFooter>
      </div>
    </DialogRoot>
  );
}
