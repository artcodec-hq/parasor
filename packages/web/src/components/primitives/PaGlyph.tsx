import type { SVGProps } from "react";

/*
 * Lucide-based monochrome icon set (ISC, see THIRD-PARTY-NOTICES.md).
 * Normalized: viewBox 24×24 / strokeWidth 1.5 / currentColor.
 * Default size = h-icon-base w-icon-base; override via className.
 */

type GlyphProps = SVGProps<SVGSVGElement>;

function Close({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function Add({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function More({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
      <circle cx="5" cy="12" r="1" />
    </svg>
  );
}

function Disclosure({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function Settings({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M14 17H5" />
      <path d="M19 7h-9" />
      <circle cx="17" cy="17" r="3" />
      <circle cx="7" cy="7" r="3" />
    </svg>
  );
}

function Search({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
    </svg>
  );
}

function Pin({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1" />
      <path d="m12 15 5 6H7Z" />
    </svg>
  );
}

function Menu({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M4 5h16" />
      <path d="M4 12h16" />
      <path d="M4 19h16" />
    </svg>
  );
}

function Back({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  );
}

function Terminal({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m10 8 4 4-4 4" />
    </svg>
  );
}

function Diff({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M12 12h.01" />
      <path d="M16 12h.01" />
      <path d="m17 7 5 5-5 5" />
      <path d="m7 7-5 5 5 5" />
      <path d="M8 12h.01" />
    </svg>
  );
}

function Git({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M11 18H8a2 2 0 0 1-2-2V9" />
    </svg>
  );
}

function Files({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </svg>
  );
}

function Browser({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

function Doc({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

function ReadOnlyProject({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function UnknownKind({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="12" cy="12" r="10" />
    </svg>
  );
}

function Branch({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M15 6a9 9 0 0 0-9 9V3" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
    </svg>
  );
}

function Monitor({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M7 21h10" />
      <rect width="20" height="14" x="2" y="3" rx="2" />
    </svg>
  );
}

function Connection({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
      <circle cx="5" cy="19" r="1" />
    </svg>
  );
}

function Pull({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M12 17V3" />
      <path d="m6 11 6 6 6-6" />
      <path d="M19 21H5" />
    </svg>
  );
}

function Push({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="m18 9-6-6-6 6" />
      <path d="M12 3v14" />
      <path d="M5 21h14" />
    </svg>
  );
}

function Refresh({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}

function Agent({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />
    </svg>
  );
}

function WorktreeActive({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z" />
      <circle cx="12" cy="13" r="2" />
      <path d="M12 15v5" />
    </svg>
  );
}

function WorktreeInactive({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M18 19a5 5 0 0 1-5-5v8" />
      <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v5" />
      <circle cx="13" cy="12" r="2" />
      <circle cx="20" cy="19" r="2" />
    </svg>
  );
}

function Working({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function Attention({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M10 15V9" />
      <path d="M14 15V9" />
    </svg>
  );
}

function CircleSmall({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <circle cx="12" cy="12" r="6" />
    </svg>
  );
}

function Modified({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M12 6v12" />
      <path d="M17.196 9 6.804 15" />
      <path d="m6.804 9 10.392 6" />
    </svg>
  );
}

function ReadOnlyFile({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="m10 10-6.157 6.162a2 2 0 0 0-.5.833l-1.322 4.36a.5.5 0 0 0 .622.624l4.358-1.323a2 2 0 0 0 .83-.5L14 13.982" />
      <path d="m12.829 7.172 4.359-4.346a1 1 0 1 1 3.986 3.986l-4.353 4.353" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function Revert({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </svg>
  );
}

function Save({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M12 13v8" />
      <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
      <path d="m8 17 4-4 4 4" />
    </svg>
  );
}

function Split({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M12 3v18" />
    </svg>
  );
}

function Eye({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOff({ className, ...p }: GlyphProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-icon-base w-icon-base"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

export const PaGlyph = {
  close: Close,
  add: Add,
  more: More,
  disclosure: Disclosure,
  settings: Settings,
  search: Search,
  pin: Pin,
  menu: Menu,
  back: Back,
  terminal: Terminal,
  diff: Diff,
  git: Git,
  files: Files,
  // Same Lucide folder shape as `files`. Aliased separately so the
  // sidebar can use it as a generic "directory" cue (non-repo project)
  // without re-implying the Files pane's tab icon semantics.
  folder: Files,
  browser: Browser,
  doc: Doc,
  readOnlyProject: ReadOnlyProject,
  unknownKind: UnknownKind,
  branch: Branch,
  monitor: Monitor,
  connection: Connection,
  pull: Pull,
  push: Push,
  refresh: Refresh,
  agent: Agent,
  worktreeActive: WorktreeActive,
  worktreeInactive: WorktreeInactive,
  working: Working,
  attention: Attention,
  circleSmall: CircleSmall,
  modified: Modified,
  readOnlyFile: ReadOnlyFile,
  revert: Revert,
  save: Save,
  split: Split,
  eye: Eye,
  eyeOff: EyeOff,
} as const;

export type PaGlyphName = keyof typeof PaGlyph;
