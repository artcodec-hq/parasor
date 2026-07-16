import { ConfirmDialog } from "../../components/primitives/index.js";

interface ClosePaneDialogProps {
  paneTitle: string;
  paneKind: "work-item" | "terminal" | "browser";
  onCancel: () => void;
  onConfirm: () => void;
}

export function ClosePaneDialog({
  paneTitle,
  paneKind,
  onCancel,
  onConfirm,
}: ClosePaneDialogProps) {
  const detail =
    paneKind === "terminal"
      ? "The shell session will terminate."
      : paneKind === "browser"
        ? "The browser tab state will be lost."
        : "The work item will remain available.";

  return (
    <ConfirmDialog
      ariaLabel={`Close ${paneTitle}`}
      confirmLabel="Close"
      confirmVariant="danger"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      Close <strong>{paneTitle}</strong>? {detail}
    </ConfirmDialog>
  );
}
