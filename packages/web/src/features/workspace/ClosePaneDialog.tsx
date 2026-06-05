import { ConfirmDialog } from "../../components/primitives/index.js";

interface ClosePaneDialogProps {
  paneTitle: string;
  paneKind: "terminal" | "browser";
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
      : "The browser tab state will be lost.";

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
