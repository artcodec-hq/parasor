import { ConfirmDialog } from "../../components/primitives/index.js";

interface DeleteProjectDialogProps {
  projectName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteProjectDialog({
  projectName,
  onCancel,
  onConfirm,
}: DeleteProjectDialogProps) {
  return (
    <ConfirmDialog
      ariaLabel={`Close project ${projectName}`}
      confirmLabel="Close"
      confirmVariant="primary"
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      Close <strong>{projectName}</strong>? All sessions in this project will
      terminate and its layout will be cleared. The directory itself will not be
      deleted.
    </ConfirmDialog>
  );
}
