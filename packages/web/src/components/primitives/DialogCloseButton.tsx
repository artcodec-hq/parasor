import { PaGlyph } from "./PaGlyph.js";

interface DialogCloseButtonProps {
  className?: string;
  label?: string;
  onClick: () => void;
}

export function DialogCloseButton({
  className = "",
  label = "Close",
  onClick,
}: DialogCloseButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex h-tap-md w-tap-md shrink-0 items-center justify-center rounded-control text-text-secondary transition-colors hover:bg-row-hover-bg hover:text-text-primary focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${className}`}
    >
      <PaGlyph.close />
    </button>
  );
}
