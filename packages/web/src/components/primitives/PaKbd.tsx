import type { ReactNode } from "react";

interface PaKbdProps {
  children: ReactNode;
  className?: string;
}

/*
 * Single-key glyph. Style comes from `.cm-kbd` in app.css -- the class is
 * shared with design canvas markup so hand-offs stay 1:1.
 */
export function PaKbd({ children, className }: PaKbdProps) {
  return (
    <span className={`cm-kbd${className ? ` ${className}` : ""}`}>
      {children}
    </span>
  );
}
