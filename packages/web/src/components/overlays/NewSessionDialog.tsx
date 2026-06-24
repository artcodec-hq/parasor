import {
  BUILTIN_SHELL_PRESETS,
  type WorktreeLocalFileCandidate,
} from "@parasor/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CustomPaneCommand,
  PaneCommand,
} from "../../lib/pane-command-store.js";
import {
  DialogCloseButton,
  DialogRoot,
  PaButton,
  PaGlyph,
} from "../primitives/index.js";

export interface NewSessionDialogProps {
  open: boolean;
  project: { id: string; name: string; path: string };
  worktree: { id: string; name: string; path: string };
  commands: PaneCommand[];
  commandConfigs: CustomPaneCommand[];
  isMobile?: boolean;
  loadLocalFiles?: (projectId: string) => Promise<{
    candidates: WorktreeLocalFileCandidate[];
    rememberedPaths: string[];
  }>;
  onClose: () => void;
  onCommandsChange: (commands: CustomPaneCommand[]) => void;
  onRunCommand: (worktreePath: string, command: PaneCommand) => void;
  onCreateWorktreeSession?: (input: {
    branch: string;
    base: string;
    copyLocalFiles: string[];
    rememberLocalFiles: boolean;
    parentWorktreePath: string;
    command: PaneCommand;
  }) => Promise<void> | void;
}

type Mode = "launcher" | "editor" | "worktree";
function makeCommandId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `cmd:${crypto.randomUUID()}`;
  }
  return `cmd:${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function displayWorktreeName({
  project,
  worktree,
}: {
  project: { path: string };
  worktree: { name: string; path: string };
}): string {
  if (worktree.path === project.path && worktree.name === "root") {
    return "Project root";
  }
  return worktree.name;
}

export function NewSessionDialog({
  open,
  project,
  worktree,
  commands,
  commandConfigs,
  isMobile = false,
  loadLocalFiles,
  onClose,
  onCommandsChange,
  onRunCommand,
  onCreateWorktreeSession,
}: NewSessionDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("launcher");
  const [editorTitle, setEditorTitle] = useState("Manage commands");
  const [editorBack, setEditorBack] = useState<(() => void) | null>(null);
  const committedRef = useRef(false);

  const runSelected = useCallback(
    (index: number) => {
      if (committedRef.current) return;
      const command = commands[index];
      if (!command) return;
      committedRef.current = true;
      onRunCommand(worktree.path, command);
      onClose();
    },
    [commands, onClose, onRunCommand, worktree.path],
  );

  useEffect(() => {
    if (!open) {
      committedRef.current = false;
      return;
    }
    setMode("launcher");
    setSelectedIndex(0);
    setEditorTitle("Manage commands");
    setEditorBack(null);
  }, [open]);

  useEffect(() => {
    if (!open || mode !== "launcher") return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((index) => Math.min(index + 1, commands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((index) => Math.max(index - 1, 0));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        runSelected(selectedIndex);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [commands.length, mode, open, runSelected, selectedIndex]);

  const handleEditorBackChange = useCallback((next: (() => void) | null) => {
    setEditorBack(next ? () => next : null);
  }, []);

  if (!open) return null;

  const worktreeDisplayName = displayWorktreeName({ project, worktree });

  const body =
    mode === "launcher" ? (
      <CommandLauncherBody
        commands={commands}
        projectName={project.name}
        selectedIndex={selectedIndex}
        worktreeName={worktreeDisplayName}
        onEdit={() => {
          setEditorTitle("Manage commands");
          setMode("editor");
        }}
        onNewWorktree={
          onCreateWorktreeSession ? () => setMode("worktree") : undefined
        }
        onRun={(index) => runSelected(index)}
        onSelect={setSelectedIndex}
      />
    ) : mode === "worktree" ? (
      <NewWorktreeSessionBody
        commands={commands}
        loadLocalFiles={loadLocalFiles}
        projectId={project.id}
        projectName={project.name}
        projectPath={project.path}
        selectedIndex={selectedIndex}
        parentWorktreePath={worktree.path}
        onBack={() => setMode("launcher")}
        onCreated={onClose}
        onCreate={onCreateWorktreeSession}
        onSelectCommand={setSelectedIndex}
      />
    ) : (
      <CommandEditorBody
        commands={commandConfigs}
        onHeaderBackChange={handleEditorBackChange}
        onTitleChange={setEditorTitle}
        onChange={onCommandsChange}
      />
    );

  return (
    <DialogRoot
      open={open}
      ariaLabel="New session"
      onClose={onClose}
      closeOnEscape={mode === "launcher"}
      presentation={isMobile ? "fullscreen" : "modal"}
      widthClassName="max-w-surface-md"
      panelClassName={`flex flex-col ${isMobile ? "min-h-0" : "max-h-[82vh]"}`}
    >
      <NewSessionHeader
        mode={mode}
        editorTitle={editorTitle}
        onBack={
          mode === "editor" && editorBack
            ? editorBack
            : () => setMode("launcher")
        }
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {body}
      </div>
    </DialogRoot>
  );
}

function NewSessionHeader({
  editorTitle,
  mode,
  onBack,
  onClose,
}: {
  editorTitle: string;
  mode: Mode;
  onBack: () => void;
  onClose: () => void;
}) {
  const title =
    mode === "editor"
      ? editorTitle
      : mode === "worktree"
        ? "New worktree session"
        : "New session";

  return (
    <div className="flex h-bar shrink-0 items-center gap-2 border-b border-border px-3">
      {mode !== "launcher" && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Back"
          className="inline-flex h-7 w-7 items-center justify-center rounded-control text-text-secondary hover:bg-row-hover-bg hover:text-text-primary focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
        >
          <PaGlyph.back />
        </button>
      )}
      <span className="flex-1 truncate text-sm font-semibold text-text-primary">
        {title}
      </span>
      <DialogCloseButton onClick={onClose} />
    </div>
  );
}

function CommandLauncherBody({
  commands,
  projectName,
  selectedIndex,
  worktreeName,
  onEdit,
  onNewWorktree,
  onRun,
  onSelect,
}: {
  commands: PaneCommand[];
  projectName: string;
  selectedIndex: number;
  worktreeName: string;
  onEdit: () => void;
  onNewWorktree?: () => void;
  onRun: (index: number) => void;
  onSelect: (index: number) => void;
}) {
  return (
    <>
      <div className="cm-mono mb-3 flex items-center gap-1.5 text-xs text-text-secondary">
        <span>{projectName}</span>
        <span className="opacity-50">/</span>
        <span>{worktreeName}</span>
      </div>
      <section className="space-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 text-xs font-medium text-text-secondary">
            Current worktree
          </span>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control border border-border bg-bg-primary px-2 text-xs font-medium text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
          >
            <PaGlyph.settings />
            <span>Manage commands</span>
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          {commands.map((command, index) => (
            <CommandRow
              command={command}
              key={command.id}
              selected={selectedIndex === index}
              onClick={() => {
                onSelect(index);
                onRun(index);
              }}
              onFocus={() => onSelect(index)}
            />
          ))}
        </div>
      </section>
      {onNewWorktree && (
        <section className="mt-4 space-y-2 border-t border-border pt-3">
          <div className="text-xs font-medium text-text-secondary">
            New worktree
          </div>
          <button
            type="button"
            onClick={onNewWorktree}
            className="flex min-h-10 w-full items-center gap-2.5 rounded-control border border-border bg-bg-primary px-3 py-2 text-left text-sm text-text-primary hover:bg-row-hover-bg"
          >
            <span className="inline-flex h-7 w-5 shrink-0 items-center justify-center text-text-secondary">
              <PaGlyph.git />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">
              Create worktree and start session
            </span>
          </button>
        </section>
      )}
    </>
  );
}

function NewWorktreeSessionBody({
  commands,
  loadLocalFiles,
  projectId,
  projectName,
  projectPath,
  selectedIndex,
  parentWorktreePath,
  onBack,
  onCreated,
  onCreate,
  onSelectCommand,
}: {
  commands: PaneCommand[];
  loadLocalFiles?: (projectId: string) => Promise<{
    candidates: WorktreeLocalFileCandidate[];
    rememberedPaths: string[];
  }>;
  projectId: string;
  projectName: string;
  projectPath: string;
  selectedIndex: number;
  parentWorktreePath: string;
  onBack: () => void;
  onCreated: () => void;
  onCreate?: (input: {
    branch: string;
    base: string;
    copyLocalFiles: string[];
    rememberLocalFiles: boolean;
    parentWorktreePath: string;
    command: PaneCommand;
  }) => Promise<void> | void;
  onSelectCommand: (index: number) => void;
}) {
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localFiles, setLocalFiles] = useState<WorktreeLocalFileCandidate[]>(
    [],
  );
  const [localFilesLoading, setLocalFilesLoading] = useState(false);
  const [localFilesError, setLocalFilesError] = useState<string | null>(null);
  const [selectedLocalFiles, setSelectedLocalFiles] = useState<Set<string>>(
    () => new Set(),
  );
  const [rememberLocalFiles, setRememberLocalFiles] = useState(false);
  const selectedCommand = commands[selectedIndex] ?? commands[0];

  useEffect(() => {
    if (!loadLocalFiles) return;
    let cancelled = false;
    setLocalFilesLoading(true);
    setLocalFilesError(null);
    void loadLocalFiles(projectId)
      .then((result) => {
        if (cancelled) return;
        setLocalFiles(result.candidates);
        const candidatePaths = new Set(
          result.candidates.map((item) => item.path),
        );
        const remembered = result.rememberedPaths.filter((item) =>
          candidatePaths.has(item),
        );
        setSelectedLocalFiles(new Set(remembered));
        setRememberLocalFiles(remembered.length > 0);
      })
      .catch((err) => {
        if (cancelled) return;
        setLocalFilesError(
          err instanceof Error ? err.message : "Failed to load local files",
        );
      })
      .finally(() => {
        if (!cancelled) setLocalFilesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadLocalFiles, projectId]);

  const previewPath = useMemo(() => {
    const trimmed = projectPath.replace(/\/+$/, "");
    return branch
      ? `${trimmed}.worktrees/${branch}`
      : `${trimmed}.worktrees/...`;
  }, [branch, projectPath]);

  const canSubmit =
    branch.trim().length > 0 && !busy && Boolean(selectedCommand);

  async function submit() {
    if (!canSubmit || !selectedCommand || !onCreate) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate({
        branch: branch.trim(),
        base: base.trim(),
        copyLocalFiles: [...selectedLocalFiles],
        rememberLocalFiles,
        parentWorktreePath,
        command: selectedCommand,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create session");
    } finally {
      setBusy(false);
    }
  }

  function toggleLocalFile(path: string, checked: boolean) {
    setSelectedLocalFiles((current) => {
      const next = new Set(current);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="cm-mono flex items-center gap-1.5 text-xs text-text-secondary">
        <span>{projectName}</span>
        <span className="opacity-50">/</span>
        <span>new worktree</span>
      </div>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-secondary">
          Branch name
        </span>
        <input
          type="text"
          value={branch}
          onChange={(event) => setBranch(event.currentTarget.value)}
          placeholder="feature/foo"
          className="cm-mono w-full rounded-control border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent/60 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-secondary">
          Base{" "}
          <span className="font-normal text-text-secondary/60">(optional)</span>
        </span>
        <input
          type="text"
          value={base}
          onChange={(event) => setBase(event.currentTarget.value)}
          placeholder="HEAD"
          className="cm-mono w-full rounded-control border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent/60 focus:outline-none"
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-text-secondary">
          Command
        </span>
        <select
          value={selectedCommand?.id ?? ""}
          onChange={(event) => {
            const index = commands.findIndex(
              (command) => command.id === event.currentTarget.value,
            );
            if (index >= 0) onSelectCommand(index);
          }}
          className="w-full rounded-control border border-border bg-bg-primary px-2.5 py-1.5 text-sm text-text-primary focus:border-accent/60 focus:outline-none"
        >
          {commands.map((command) => (
            <option key={command.id} value={command.id}>
              {command.label}
            </option>
          ))}
        </select>
      </label>
      <div>
        <span className="mb-1 block text-xs font-medium text-text-secondary">
          Path
        </span>
        <div
          className="cm-mono truncate rounded-control border border-border/60 bg-bg-primary/60 px-2.5 py-1.5 text-xs text-text-secondary"
          title={previewPath}
        >
          {previewPath}
        </div>
      </div>
      <div className="rounded-control border border-border/70 bg-bg-primary/40 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-xs font-medium text-text-secondary">
            Local files
          </span>
          {localFiles.length > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-text-secondary">
              <input
                type="checkbox"
                checked={rememberLocalFiles}
                onChange={(event) =>
                  setRememberLocalFiles(event.currentTarget.checked)
                }
                className="h-3.5 w-3.5 accent-accent"
              />
              Remember
            </label>
          )}
        </div>
        {localFilesLoading ? (
          <div className="text-xs text-text-secondary">
            Loading local files...
          </div>
        ) : localFilesError ? (
          <div className="text-xs text-danger">{localFilesError}</div>
        ) : localFiles.length === 0 ? (
          <div className="text-xs text-text-secondary">
            No ignored local files found.
          </div>
        ) : (
          <div className="max-h-28 space-y-1 overflow-y-auto pr-1">
            {localFiles.map((file) => (
              <label
                key={file.path}
                className="flex min-h-7 items-center gap-2 rounded-control px-1 text-xs text-text-primary hover:bg-bg-secondary"
              >
                <input
                  type="checkbox"
                  checked={selectedLocalFiles.has(file.path)}
                  onChange={(event) =>
                    toggleLocalFile(file.path, event.currentTarget.checked)
                  }
                  className="h-3.5 w-3.5 shrink-0 accent-accent"
                />
                <span className="cm-mono min-w-0 flex-1 truncate">
                  {file.path}
                </span>
                <span className="shrink-0 text-text-secondary/70">
                  {formatBytes(file.size)}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div className="rounded-control border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
          {error}
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <PaButton kind="normal" size="sm" type="button" onClick={onBack}>
          Back
        </PaButton>
        <div className="flex-1" />
        <PaButton kind="submit" size="sm" type="submit" disabled={!canSubmit}>
          {busy ? "Creating..." : "Create session"}
        </PaButton>
      </div>
    </form>
  );
}

function CommandRow({
  command,
  selected,
  onClick,
  onFocus,
}: {
  command: PaneCommand;
  selected: boolean;
  onClick: () => void;
  onFocus: () => void;
}) {
  const commandText = command.initialInput || "empty shell";
  return (
    <button
      type="button"
      onClick={onClick}
      onFocus={onFocus}
      aria-pressed={selected}
      className={`
        flex min-h-12 items-center gap-2.5 rounded-control border px-3 py-2 text-left transition-colors
        ${selected ? "border-accent/60 bg-accent/10" : "border-border bg-bg-primary hover:bg-row-hover-bg"}
      `}
    >
      <span className="inline-flex h-7 w-5 shrink-0 items-center justify-center text-text-secondary">
        <PaGlyph.terminal />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">
          {command.label}
        </span>
        <span className="cm-mono block truncate text-xs text-text-secondary">
          {commandText}
        </span>
      </span>
      {!command.builtin && (
        <span className="cm-mono shrink-0 rounded-tag bg-accent/10 px-1.5 py-[1px] text-xs text-accent">
          run
        </span>
      )}
    </button>
  );
}

function CommandEditorBody({
  commands,
  onHeaderBackChange,
  onTitleChange,
  onChange,
}: {
  commands: CustomPaneCommand[];
  onHeaderBackChange: (back: (() => void) | null) => void;
  onTitleChange: (title: string) => void;
  onChange: (commands: CustomPaneCommand[]) => void;
}) {
  const [editing, setEditing] = useState<{
    command: CustomPaneCommand;
    variant: CommandEditVariant;
    allowEmptyCommand?: boolean;
    onDelete?: () => void;
    onReset?: () => void;
    title: string;
  } | null>(null);
  const customCommands = commands.filter(
    (command) => !isBuiltinCommand(command),
  );
  const startNew = () =>
    setEditing({
      command: { id: makeCommandId(), label: "", initialInput: "" },
      variant: "new",
      title: "New custom command",
    });

  useEffect(() => {
    if (!editing) {
      onTitleChange("Manage commands");
      onHeaderBackChange(null);
      return;
    }
    onTitleChange(editing.title);
    onHeaderBackChange(() => setEditing(null));
    return () => onHeaderBackChange(null);
  }, [editing, onHeaderBackChange, onTitleChange]);

  if (editing) {
    return (
      <CommandForm
        allowEmptyCommand={editing.allowEmptyCommand}
        command={editing.command}
        variant={editing.variant}
        onCancel={() => setEditing(null)}
        onDelete={editing.onDelete}
        onReset={editing.onReset}
        onSave={(next) => {
          const builtinPreset = BUILTIN_SHELL_PRESETS.find(
            (preset) => preset.id === next.id,
          );
          if (builtinPreset) {
            onChange(
              upsertBuiltinCommand(commands, builtinPreset, {
                enabled: next.enabled !== false,
                initialInput: next.initialInput,
              }),
            );
            setEditing(null);
            return;
          }
          const exists = commands.some((command) => command.id === next.id);
          onChange(
            exists
              ? commands.map((command) =>
                  command.id === next.id ? next : command,
                )
              : [...commands, next],
          );
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="space-y-2">
        <div className="text-xs font-medium text-text-secondary">
          Built-in commands
        </div>
        <div className="flex flex-col gap-1.5">
          {BUILTIN_SHELL_PRESETS.map((preset) => {
            const command = builtinEditorCommand(commands, preset);
            const enabled = command.enabled !== false;
            const canToggle = preset.group === "agent";
            return (
              <div
                className="flex min-h-12 items-center gap-2.5 rounded-control border border-border bg-bg-primary px-3 py-2"
                key={preset.id}
              >
                <span className="inline-flex h-7 w-5 shrink-0 items-center justify-center text-text-secondary">
                  <PaGlyph.terminal />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text-primary">
                    {preset.label}
                  </div>
                  <div className="cm-mono truncate text-xs text-text-secondary">
                    {command.initialInput || "empty shell"}
                  </div>
                </div>
                {canToggle && (
                  <label className="inline-flex h-8 shrink-0 items-center gap-1.5 text-xs text-text-secondary">
                    <input
                      checked={enabled}
                      className="h-3.5 w-3.5 accent-accent"
                      type="checkbox"
                      onChange={(event) =>
                        onChange(
                          upsertBuiltinCommand(commands, preset, {
                            enabled: event.currentTarget.checked,
                            initialInput: command.initialInput,
                          }),
                        )
                      }
                    />
                    <span>{enabled ? "On" : "Off"}</span>
                  </label>
                )}
                <PaButton
                  kind="normal"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      command,
                      variant: "builtin",
                      allowEmptyCommand: preset.commandLine === "",
                      title: `Edit ${preset.label}`,
                      onReset: () => {
                        onChange(
                          removeBuiltinCommandOverride(commands, preset.id),
                        );
                        setEditing(null);
                      },
                    })
                  }
                >
                  Edit
                </PaButton>
              </div>
            );
          })}
        </div>
      </section>
      <section className="space-y-2 border-t border-border pt-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1 text-xs font-medium text-text-secondary">
            Custom commands
          </div>
          <button
            type="button"
            onClick={startNew}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-control border border-border bg-bg-primary px-2 text-xs font-medium text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
          >
            <PaGlyph.add />
            <span>Add</span>
          </button>
        </div>
        {customCommands.length === 0 ? (
          <div className="rounded-control border border-dashed border-border px-3 py-6 text-center text-sm text-text-secondary">
            No custom commands
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {customCommands.map((command) => (
              <div
                className="flex min-h-12 items-center gap-2.5 rounded-control border border-border bg-bg-primary px-3 py-2"
                key={command.id}
              >
                <span className="inline-flex h-7 w-5 shrink-0 items-center justify-center text-text-secondary">
                  <PaGlyph.terminal />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text-primary">
                    {command.label}
                  </div>
                  <div className="cm-mono truncate text-xs text-text-secondary">
                    {command.initialInput}
                  </div>
                </div>
                <PaButton
                  kind="normal"
                  size="sm"
                  onClick={() =>
                    setEditing({
                      command,
                      variant: "custom",
                      title: "Edit command",
                      onDelete: () => {
                        onChange(
                          commands.filter((item) => item.id !== command.id),
                        );
                        setEditing(null);
                      },
                    })
                  }
                >
                  Edit
                </PaButton>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

type BuiltinPreset = (typeof BUILTIN_SHELL_PRESETS)[number];
type CommandEditVariant = "new" | "custom" | "builtin";

function isBuiltinCommand(command: CustomPaneCommand): boolean {
  return command.id.startsWith("builtin:");
}

function builtinEditorCommand(
  commands: CustomPaneCommand[],
  preset: BuiltinPreset,
): CustomPaneCommand {
  const override = commands.find((command) => command.id === preset.id);
  return {
    id: preset.id,
    label: preset.label,
    initialInput: override?.initialInput ?? preset.commandLine,
    enabled: preset.group === "terminal" ? true : override?.enabled !== false,
  };
}

function upsertBuiltinCommand(
  commands: CustomPaneCommand[],
  preset: BuiltinPreset,
  patch: { enabled: boolean; initialInput: string },
): CustomPaneCommand[] {
  const next = {
    id: preset.id,
    label: preset.label,
    initialInput: patch.initialInput.trim(),
    enabled: patch.enabled,
  };
  const without = commands.filter((command) => command.id !== preset.id);
  if (next.enabled && next.initialInput === preset.commandLine) return without;
  return [...without, next];
}

function removeBuiltinCommandOverride(
  commands: CustomPaneCommand[],
  presetId: string,
): CustomPaneCommand[] {
  return commands.filter((command) => command.id !== presetId);
}

function CommandForm({
  allowEmptyCommand = false,
  command,
  onCancel,
  onDelete,
  onReset,
  onSave,
  variant,
}: {
  allowEmptyCommand?: boolean;
  command: CustomPaneCommand;
  onCancel: () => void;
  onDelete?: () => void;
  onReset?: () => void;
  onSave: (command: CustomPaneCommand) => void;
  variant: CommandEditVariant;
}) {
  const [label, setLabel] = useState(command.label);
  const [initialInput, setInitialInput] = useState(command.initialInput);
  const normalizedLabel = label.trim();
  const normalizedInput = initialInput.trim();
  const labelRequired = variant !== "builtin";
  const canSave =
    (!labelRequired || normalizedLabel.length > 0) &&
    (allowEmptyCommand || normalizedInput.length > 0);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        onSave({
          id: command.id,
          label: variant === "builtin" ? command.label : normalizedLabel,
          initialInput: normalizedInput,
          ...(command.enabled !== undefined && { enabled: command.enabled }),
        });
      }}
    >
      {variant === "builtin" ? (
        <div className="rounded-control border border-border bg-bg-primary px-2.5 py-2">
          <div className="mb-0.5 text-xs font-medium text-text-secondary">
            Built-in command
          </div>
          <div className="truncate text-sm font-semibold text-text-primary">
            {command.label}
          </div>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
          <span>Label</span>
          <input
            className="h-9 rounded-control border border-border bg-bg-primary px-2 text-sm text-text-primary outline-none focus:border-accent"
            value={label}
            onChange={(event) => setLabel(event.currentTarget.value)}
          />
        </label>
      )}
      <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
        <span>Command</span>
        <input
          className="cm-mono h-9 rounded-control border border-border bg-bg-primary px-2 text-sm text-text-primary outline-none focus:border-accent"
          value={initialInput}
          onChange={(event) => setInitialInput(event.currentTarget.value)}
        />
      </label>
      <div className="flex items-center gap-2">
        {onDelete && (
          <PaButton kind="destroy" size="sm" type="button" onClick={onDelete}>
            Delete
          </PaButton>
        )}
        {onReset && (
          <PaButton kind="normal" size="sm" type="button" onClick={onReset}>
            Reset to default
          </PaButton>
        )}
        <div className="flex-1" />
        <PaButton kind="normal" size="sm" type="button" onClick={onCancel}>
          Cancel
        </PaButton>
        <PaButton kind="submit" size="sm" type="submit" disabled={!canSave}>
          Save
        </PaButton>
      </div>
    </form>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.ceil(bytes / 1024)} KB`;
}
