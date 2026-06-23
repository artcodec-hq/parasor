import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "../../hooks/use-focus-trap.js";
import { DialogCloseButton } from "./DialogCloseButton.js";
import { PaButton, type PaButtonKind } from "./PaButton.js";

type DialogPresentation = "fullscreen" | "modal";

interface DialogRootProps {
  open: boolean;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  onClose: () => void;
  children: ReactNode;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  dialogRole?: "alertdialog" | "dialog";
  presentation?: DialogPresentation;
  backdropClassName?: string;
  onPanelContextMenu?: HTMLAttributes<HTMLDivElement>["onContextMenu"];
  panelClassName?: string;
  panelTabIndex?: number;
  widthClassName?: string;
}

export function DialogRoot({
  open,
  ariaLabel,
  ariaLabelledBy,
  onClose,
  children,
  closeOnBackdrop = true,
  closeOnEscape = true,
  dialogRole = "dialog",
  presentation = "modal",
  backdropClassName = "bg-black/60",
  onPanelContextMenu,
  panelClassName = "",
  panelTabIndex,
  widthClassName = "max-w-surface-md",
}: DialogRootProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [entered, setEntered] = useState(false);
  useFocusTrap(open, panelRef);

  useEffect(() => {
    if (!open) {
      setEntered(false);
      return;
    }
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => {
      cancelAnimationFrame(frame);
      setEntered(false);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [closeOnEscape, open, onClose]);

  if (!open) return null;

  if (presentation === "fullscreen") {
    return (
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-150 ease-out motion-reduce:transition-none ${
          entered ? "opacity-100" : "opacity-0"
        } ${backdropClassName}`}
        role="presentation"
      >
        {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useAriaPropsSupportedByRole: role is constrained to dialog/alertdialog and panel context-menu handling is opt-in for blocking alert dialogs. */}
        <div
          ref={panelRef}
          role={dialogRole}
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          tabIndex={panelTabIndex}
          onContextMenu={onPanelContextMenu}
          className={`flex h-full w-full min-w-0 bg-bg-secondary transition-opacity duration-150 ease-out motion-reduce:transition-none ${
            entered ? "opacity-100" : "opacity-0"
          } ${panelClassName}`}
        >
          {children}
        </div>
      </div>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop click dismisses the modal without changing the dialog semantics.
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-150 ease-out motion-reduce:transition-none ${
        entered ? "opacity-100" : "opacity-0"
      } ${backdropClassName}`}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useAriaPropsSupportedByRole: role is constrained to dialog/alertdialog and panel context-menu handling is opt-in for blocking alert dialogs. */}
      <div
        ref={panelRef}
        role={dialogRole}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        tabIndex={panelTabIndex}
        onContextMenu={onPanelContextMenu}
        className={`w-full ${widthClassName} rounded-window border border-border bg-bg-secondary shadow-xl transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none ${
          entered
            ? "translate-y-0 scale-100 opacity-100"
            : "translate-y-1 scale-[0.98] opacity-0"
        } ${panelClassName}`}
      >
        {children}
      </div>
    </div>
  );
}

interface DialogHeaderProps {
  title: string;
  subject?: string;
  onClose: () => void;
}

export function DialogHeader({ title, subject, onClose }: DialogHeaderProps) {
  return (
    <div className="flex h-bar min-w-0 shrink-0 items-center gap-2 border-b border-border px-3">
      <span
        className={`min-w-0 truncate text-sm ${
          subject ? "text-text-secondary" : "font-semibold text-text-primary"
        }`}
      >
        {title}
      </span>
      {subject && (
        <span className="cm-mono min-w-0 truncate text-sm font-semibold text-text-primary">
          {subject}
        </span>
      )}
      <DialogCloseButton className="ml-auto" onClick={onClose} />
    </div>
  );
}

interface DialogFooterProps {
  children: ReactNode;
  layout?: "end" | "stack";
}

export function DialogFooter({ children, layout = "end" }: DialogFooterProps) {
  if (layout === "stack") {
    return (
      <div className="flex w-full min-w-0 flex-col items-stretch gap-2 pt-1">
        {children}
      </div>
    );
  }

  return (
    <div className="flex w-full min-w-0 flex-wrap items-center justify-end gap-2 overflow-hidden pt-1">
      {children}
    </div>
  );
}

interface DialogButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "normal" | "primary" | "danger";
  ref?: Ref<HTMLButtonElement>;
}

export function DialogButton({
  children,
  type = "button",
  variant = "normal",
  ref,
  className,
  ...buttonProps
}: DialogButtonProps) {
  const kind: PaButtonKind =
    variant === "danger"
      ? "destroy"
      : variant === "primary"
        ? "submit"
        : "normal";
  return (
    <PaButton
      ref={ref}
      type={type}
      kind={kind}
      size="sm"
      className={`min-w-0 max-w-full overflow-hidden ${className ?? ""}`}
      {...buttonProps}
    >
      <span className="min-w-0 truncate">{children}</span>
    </PaButton>
  );
}

interface ConfirmDialogProps {
  ariaLabel: string;
  children: ReactNode;
  confirmLabel: string;
  confirmVariant?: "primary" | "danger";
  onCancel: () => void;
  onConfirm: () => void;
  panelClassName?: string;
}

export function ConfirmDialog({
  ariaLabel,
  children,
  confirmLabel,
  confirmVariant = "primary",
  onCancel,
  onConfirm,
  panelClassName = "",
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const frame = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <DialogRoot
      open={true}
      ariaLabel={ariaLabel}
      onClose={onCancel}
      widthClassName="max-w-surface-sm"
      panelClassName={`p-6 ${panelClassName}`}
    >
      <div className="mb-4 text-sm leading-[1.55] text-text-primary">
        {children}
      </div>
      <DialogFooter>
        <DialogButton onClick={onCancel}>Cancel</DialogButton>
        <DialogButton
          ref={confirmRef}
          variant={confirmVariant}
          onClick={onConfirm}
        >
          {confirmLabel}
        </DialogButton>
      </DialogFooter>
    </DialogRoot>
  );
}
