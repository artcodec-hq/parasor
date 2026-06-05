import {
  type ActionItem,
  ActionSheet,
  FloatingActionMenu,
} from "../../../components/primitives/index.js";
import { shellEscape } from "../../../lib/shell-escape.js";
import {
  hasActiveTerminal,
  sendToActiveTerminal,
} from "../../../lib/terminal-registry.js";

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory";
}

export interface FileContextMenuProps {
  entry: FileEntry;
  projectPath?: string;
  x: number;
  y: number;
  onClose: () => void;
  onDuplicate?: (entry: FileEntry) => void;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}

export function FileContextMenu({
  entry,
  projectPath,
  x,
  y,
  onClose,
  onDuplicate,
}: FileContextMenuProps) {
  const isMobile = "ontouchstart" in window;
  const isDesktop = !isMobile;
  const canInsertToTerminal = Boolean(projectPath) && hasActiveTerminal();

  const actions: ActionItem[] = [
    {
      id: "copy-path",
      label: "Copy Path",
      onSelect: () => copyToClipboard(entry.path),
    },
    {
      id: "copy-at-path",
      label: "Copy as @path",
      onSelect: () => copyToClipboard(`@${entry.path}`),
    },
  ];
  if (canInsertToTerminal && projectPath) {
    const absolute = `${projectPath.replace(/\/+$/, "")}/${entry.path}`;
    actions.push({
      id: "insert-path",
      label: "Insert path into terminal",
      onSelect: () => sendToActiveTerminal(shellEscape(absolute)),
    });
  }
  if (onDuplicate) {
    actions.push({
      id: "duplicate",
      label: "Duplicate",
      onSelect: () => onDuplicate(entry),
    });
  }
  if (isDesktop) {
    actions.push({
      id: "reveal-finder",
      label: "Reveal in Finder",
      separatorBefore: true,
      onSelect: () => copyToClipboard(entry.path),
    });
  }

  if (isMobile) {
    return (
      <ActionSheet
        open={true}
        onDismiss={onClose}
        ariaLabel={`Actions for ${entry.name}`}
        title={entry.path}
        items={actions}
      />
    );
  }

  return (
    <FloatingActionMenu
      open={true}
      anchorPoint={{ x, y }}
      items={actions}
      onClose={onClose}
    />
  );
}
