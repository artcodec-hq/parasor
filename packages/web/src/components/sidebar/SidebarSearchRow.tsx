import { useEffect, useRef } from "react";
import { PaGlyph } from "../primitives/index.js";
import {
  SIDEBAR_ROW_INSET_CLASS,
  SidebarRowActionButton,
} from "./primitives/index.js";

interface SidebarSearchRowProps {
  query: string;
  onClose?: () => void;
  onQueryChange?: (next: string) => void;
}

export function SidebarSearchRow({
  query,
  onClose,
  onQueryChange,
}: SidebarSearchRowProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  // iOS Safari/WebKit fires Escape during IME composition with
  // `nativeEvent.isComposing` already false. Track composition explicitly so a
  // Japanese candidate-cancel Escape never closes the filter.
  const composingRef = useRef(false);

  useEffect(() => {
    composingRef.current = false;
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      className={`flex h-bar shrink-0 items-center gap-2 border-t border-border bg-bg-secondary ${SIDEBAR_ROW_INSET_CLASS[0]}`}
    >
      <span className="shrink-0 text-text-secondary">
        <PaGlyph.search />
      </span>
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange?.(e.target.value)}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={() => {
          composingRef.current = false;
        }}
        onBlur={() => {
          composingRef.current = false;
        }}
        onKeyDown={(e) => {
          if (
            e.key === "Escape" &&
            !e.nativeEvent.isComposing &&
            !composingRef.current
          ) {
            e.preventDefault();
            onClose?.();
          }
        }}
        maxLength={256}
        placeholder="Filter sidebar…"
        aria-label="Filter sidebar"
        className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-secondary focus:outline-none"
      />
      {onClose && (
        <SidebarRowActionButton
          onClick={onClose}
          aria-label="Close sidebar filter"
        >
          <PaGlyph.close />
        </SidebarRowActionButton>
      )}
    </div>
  );
}
