import type { PortInfo } from "@parasor/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { PaGlyph } from "../primitives/index.js";
import { SidebarRowActionButton } from "./primitives/index.js";

interface NetworkPortCenterProps {
  connected: boolean;
  portsByProjectId?: Record<string, PortInfo[]>;
  projectNames?: Record<string, string>;
  onOpenUrl?: (url: string, options?: OpenUrlOptions) => void;
}

interface PortCenterEntry {
  key: string;
  port: number;
  projectId: string;
  projectName: string;
  reachable: boolean;
  url: string;
}

function buildPortEntries(
  portsByProjectId: Record<string, PortInfo[]> | undefined,
  projectNames: Record<string, string> | undefined,
): PortCenterEntry[] {
  const entries: PortCenterEntry[] = [];
  for (const [projectId, ports] of Object.entries(portsByProjectId ?? {})) {
    for (const info of ports ?? []) {
      entries.push({
        key: `${projectId}:${info.port}`,
        port: info.port,
        projectId,
        projectName: projectNames?.[projectId] ?? "project",
        reachable: info.reachable ?? info.bindsAll,
        url: `http://localhost:${info.port}`,
      });
    }
  }
  return entries.sort((a, b) =>
    a.projectName === b.projectName
      ? a.port - b.port
      : a.projectName.localeCompare(b.projectName),
  );
}

function usePortCenterState(
  portsByProjectId: Record<string, PortInfo[]> | undefined,
  projectNames: Record<string, string> | undefined,
) {
  const initializedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [seenPortKeys, setSeenPortKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const entries = useMemo(
    () => buildPortEntries(portsByProjectId, projectNames),
    [portsByProjectId, projectNames],
  );
  const currentPortKeys = useMemo(
    () => new Set(entries.map((entry) => entry.key)),
    [entries],
  );

  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      setSeenPortKeys(new Set(currentPortKeys));
      return;
    }
    setSeenPortKeys((prev) => {
      const next = new Set<string>();
      for (const key of prev) {
        if (currentPortKeys.has(key)) next.add(key);
      }
      if (open) {
        for (const key of currentPortKeys) next.add(key);
      }
      return next;
    });
  }, [currentPortKeys, open]);

  const hasUnread = entries.some((entry) => !seenPortKeys.has(entry.key));
  const markCurrentSeen = () => setSeenPortKeys(new Set(currentPortKeys));

  return {
    currentPortKeys,
    entries,
    hasUnread,
    markCurrentSeen,
    open,
    setOpen,
  };
}

export function NetworkPortCenter({
  connected,
  portsByProjectId,
  projectNames,
  onOpenUrl,
}: NetworkPortCenterProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const { entries, hasUnread, markCurrentSeen, open, setOpen } =
    usePortCenterState(portsByProjectId, projectNames);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && root.contains(event.target)) {
        return;
      }
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  return (
    <span ref={rootRef} className="flex items-center">
      <SidebarRowActionButton
        aria-label={hasUnread ? "Network ports, new ports" : "Network ports"}
        aria-expanded={open}
        title={connected ? "Network ports" : "Offline"}
        tone={connected ? "accentPrimaryHover" : "dangerPrimaryHover"}
        onClick={() => {
          setOpen((nextOpen) => !nextOpen);
          markCurrentSeen();
        }}
      >
        <PaGlyph.connection />
        {hasUnread && (
          <span
            aria-hidden
            className="absolute top-1/2 -right-1.5 h-1.5 w-1.5 -translate-y-1/2 rounded-tag bg-accent"
          />
        )}
      </SidebarRowActionButton>
      {open && (
        <div className="fixed bottom-11 left-3 z-50 w-[min(20rem,calc(100vw-1.5rem))] rounded-window border border-border bg-bg-secondary p-2 text-left shadow-lg">
          <div className="flex items-center justify-between px-1 pb-1.5">
            <span className="text-xs font-semibold text-text-primary">
              Detected ports
            </span>
            <span className="cm-mono text-xs text-text-secondary">
              {entries.length}
            </span>
          </div>
          {entries.length === 0 ? (
            <div className="px-1 py-2 text-xs text-text-secondary">
              No detected ports
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto">
              {entries.map((entry) => (
                <div
                  key={entry.key}
                  className="flex items-center gap-2 rounded-control px-1.5 py-1.5 hover:bg-row-hover-bg"
                >
                  <span
                    aria-hidden
                    className={`h-2 w-2 shrink-0 rounded-tag ${
                      entry.reachable ? "bg-accent" : "bg-warning"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="cm-mono text-xs text-text-primary">
                      {entry.port}
                    </div>
                    <div className="truncate text-xs text-text-secondary">
                      {entry.projectName}
                      {!entry.reachable && " - localhost only"}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!entry.reachable || !onOpenUrl}
                    onClick={() => {
                      onOpenUrl?.(entry.url, { projectId: entry.projectId });
                      setOpen(false);
                    }}
                    className="flex h-7 shrink-0 items-center rounded-control px-2 text-xs text-accent hover:bg-row-hover-bg disabled:text-text-secondary disabled:opacity-50"
                  >
                    Open
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}
