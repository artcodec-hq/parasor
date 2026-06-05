import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

interface EditablePaneTitleProps {
  value: string;
  onSave: (title: string) => Promise<void> | void;
}

export function EditablePaneTitle({ value, onSave }: EditablePaneTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);

  useEffect(() => {
    if (!editing) return;
    if (inputRef.current && document.activeElement === inputRef.current) return;
    const id = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [editing]);

  const startEditing = useCallback(() => {
    flushSync(() => setEditing(true));
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = async () => {
    const next = draft.trim();
    setEditing(false);
    setError(null);
    if (next === value.trim()) return;
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Rename failed");
      setDraft(value);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        aria-label="Terminal title"
        title={error ?? undefined}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={() => {
          if (cancelRef.current) {
            cancelRef.current = false;
            return;
          }
          void commit();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancelRef.current = true;
            setDraft(value);
            setEditing(false);
            setError(null);
          }
        }}
        className="h-7 min-w-0 flex-shrink rounded-control border border-accent bg-bg-primary px-1.5 text-sm font-semibold text-text-primary outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      aria-label="Rename terminal"
      title={error ?? value}
      onClick={startEditing}
      className={`min-w-0 flex-shrink truncate rounded-control px-1 text-left text-sm font-semibold text-text-primary hover:bg-row-hover-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${
        error ? "text-danger" : ""
      }`}
    >
      {value}
    </button>
  );
}
