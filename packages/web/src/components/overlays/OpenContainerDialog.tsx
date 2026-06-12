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
  DialogButton,
  DialogCloseButton,
  DialogFooter,
  DialogRoot,
  PaButton,
  PaGlyph,
  PaKbd,
} from "../primitives/index.js";

export interface OpenContainerDialogProps {
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

export function OpenContainerDialog({
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
}: OpenContainerDialogProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>("launcher");
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

  if (!open) return null;

  const body =
    mode === "launcher" ? (
      <CommandLauncherBody
        commands={commands}
        projectName={project.name}
        selectedIndex={selectedIndex}
        worktreeName={worktree.name}
        onEdit={() => setMode("editor")}
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
        onBack={() => setMode("launcher")}
        onChange={onCommandsChange}
      />
    );

  return (
    <DialogRoot
      open={open}
      ariaLabel={`New session in ${worktree.name}`}
      onClose={onClose}
      closeOnEscape={mode === "launcher"}
      presentation={isMobile ? "sheet" : "modal"}
      widthClassName="max-w-surface-md"
      panelClassName={`flex flex-col ${isMobile ? "h-[calc(80vh-1.5rem)] min-h-0" : "max-h-[82vh]"}`}
    >
      <OpenContainerHeader
        mode={mode}
        title={worktree.name}
        onBack={() => setMode("launcher")}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-4">
        {body}
      </div>

      {isMobile ? (
        <div className="flex shrink-0 items-center border-t border-border px-3 py-2.5">
          <DialogFooter layout="stack">
            <DialogButton onClick={onClose}>Cancel</DialogButton>
          </DialogFooter>
        </div>
      ) : (
        mode === "launcher" && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
            <div className="cm-mono flex min-w-0 flex-1 flex-wrap items-center gap-2 text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1">
                <PaKbd>↑↓</PaKbd>
                <span>navigate</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <PaKbd>↵</PaKbd>
                <span>run</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <PaKbd>Esc</PaKbd>
                <span>cancel</span>
              </span>
            </div>
            <DialogButton onClick={onClose}>Cancel</DialogButton>
          </div>
        )
      )}
    </DialogRoot>
  );
}

function OpenContainerHeader({
  mode,
  title,
  onBack,
  onClose,
}: {
  mode: Mode;
  title: string;
  onBack: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
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
      <span className="inline-flex text-accent" aria-hidden>
        {mode === "editor" ? <PaGlyph.settings /> : <PaGlyph.terminal />}
      </span>
      <span className="text-sm text-text-secondary">
        {mode === "editor"
          ? "Commands"
          : mode === "worktree"
            ? "New session"
            : "New session in"}
      </span>
      <span className="cm-mono flex-1 truncate text-sm font-semibold text-text-primary">
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
      <div className="cm-mono mb-2.5 flex items-center gap-1.5 text-xs text-text-secondary">
        <span>{projectName}</span>
        <span className="opacity-50">/</span>
        <span>{worktreeName}</span>
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
      <button
        type="button"
        onClick={onEdit}
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-control border border-border text-sm text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
      >
        <PaGlyph.settings />
        <span>Edit commands</span>
      </button>
      {onNewWorktree && (
        <button
          type="button"
          onClick={onNewWorktree}
          className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-control border border-border text-sm text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
        >
          <PaGlyph.worktreeInactive />
          <span>New worktree session</span>
        </button>
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
        flex min-h-14 items-center gap-3 rounded-control border px-3 py-2 text-left
        ${selected ? "border-accent/65 bg-accent/10 shadow-[0_0_0_2px_rgb(var(--color-accent)/0.22)]" : "border-border bg-bg-primary hover:bg-row-hover-bg"}
      `}
    >
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-text-secondary/10 text-text-primary">
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
  onBack,
  onChange,
}: {
  commands: CustomPaneCommand[];
  onBack: () => void;
  onChange: (commands: CustomPaneCommand[]) => void;
}) {
  const [editing, setEditing] = useState<{
    command: CustomPaneCommand;
    fixedLabel?: boolean;
    allowEmptyCommand?: boolean;
    onReset?: () => void;
  } | null>(null);
  const customCommands = commands.filter(
    (command) => !isBuiltinCommand(command),
  );
  const startNew = () =>
    setEditing({
      command: { id: makeCommandId(), label: "", initialInput: "" },
    });

  if (editing) {
    return (
      <CommandForm
        allowEmptyCommand={editing.allowEmptyCommand}
        command={editing.command}
        fixedLabel={editing.fixedLabel}
        onCancel={() => setEditing(null)}
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
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <PaButton kind="normal" size="sm" onClick={onBack}>
          Done
        </PaButton>
        <div className="flex-1" />
        <PaButton kind="submit" size="sm" onClick={startNew}>
          <span className="inline-flex items-center gap-1">
            <PaGlyph.add />
            <span>Add</span>
          </span>
        </PaButton>
      </div>
      <div className="flex flex-col gap-1.5">
        {BUILTIN_SHELL_PRESETS.map((preset) => {
          const command = builtinEditorCommand(commands, preset);
          const enabled = command.enabled !== false;
          const canToggle = preset.group === "agent";
          return (
            <div
              className="flex items-center gap-2 rounded-control border border-border bg-bg-primary px-3 py-2"
              key={preset.id}
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-text-secondary/10">
                {preset.group === "terminal" ? (
                  <PaGlyph.terminal />
                ) : (
                  <PaGlyph.agent />
                )}
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
                <label className="inline-flex h-8 shrink-0 items-center gap-2 text-xs text-text-secondary">
                  <input
                    checked={enabled}
                    className="h-4 w-4 accent-accent"
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
                    fixedLabel: true,
                    allowEmptyCommand: preset.commandLine === "",
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
      {customCommands.length === 0 ? (
        <div className="rounded-control border border-dashed border-border px-3 py-6 text-center text-sm text-text-secondary">
          No custom commands
        </div>
      ) : (
        customCommands.map((command) => (
          <div
            className="flex items-center gap-2 rounded-control border border-border bg-bg-primary px-3 py-2"
            key={command.id}
          >
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
              onClick={() => setEditing({ command })}
            >
              Edit
            </PaButton>
            <PaButton
              kind="destroy"
              size="sm"
              onClick={() =>
                onChange(commands.filter((item) => item.id !== command.id))
              }
            >
              Delete
            </PaButton>
          </div>
        ))
      )}
    </div>
  );
}

type BuiltinPreset = (typeof BUILTIN_SHELL_PRESETS)[number];

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
  fixedLabel = false,
  onCancel,
  onReset,
  onSave,
}: {
  allowEmptyCommand?: boolean;
  command: CustomPaneCommand;
  fixedLabel?: boolean;
  onCancel: () => void;
  onReset?: () => void;
  onSave: (command: CustomPaneCommand) => void;
}) {
  const [label, setLabel] = useState(command.label);
  const [initialInput, setInitialInput] = useState(command.initialInput);
  const normalizedLabel = label.trim();
  const normalizedInput = initialInput.trim();
  const canSave =
    normalizedLabel.length > 0 &&
    (allowEmptyCommand || normalizedInput.length > 0);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSave) return;
        onSave({
          id: command.id,
          label: normalizedLabel,
          initialInput: normalizedInput,
          ...(command.enabled !== undefined && { enabled: command.enabled }),
        });
      }}
    >
      {fixedLabel ? (
        <div className="flex flex-col gap-1.5 text-sm text-text-secondary">
          <span>Name</span>
          <div className="h-9 rounded-control border border-border bg-bg-primary px-2 py-2 text-sm text-text-primary">
            {command.label}
          </div>
        </div>
      ) : (
        <label className="flex flex-col gap-1.5 text-sm text-text-secondary">
          <span>Name</span>
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
        <PaButton kind="normal" size="sm" type="button" onClick={onCancel}>
          Cancel
        </PaButton>
        {onReset && (
          <PaButton kind="normal" size="sm" type="button" onClick={onReset}>
            Reset
          </PaButton>
        )}
        <div className="flex-1" />
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
