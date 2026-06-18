import type { PortInfo, RuntimeServiceInfo, Session } from "@parasor/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import type { OpenUrlOptions } from "../../lib/open-url-options.js";
import { PaGlyph } from "../primitives/index.js";
import { SidebarRowActionButton } from "./primitives/index.js";

interface NetworkPortCenterProps {
  connected: boolean;
  portsByProjectId?: Record<string, PortInfo[]>;
  servicesByProjectId?: Record<string, RuntimeServiceInfo[]>;
  projectNames?: Record<string, string>;
  sessions?: Session[];
  onOpenUrl?: (url: string, options?: OpenUrlOptions) => void;
}

interface PortCenterEntry {
  key: string;
  port: number;
  projectId: string;
  projectName: string;
  reachable: boolean;
  url: string;
  title: string;
  detail: string;
  lifecycle?: RuntimeServiceInfo["lifecycle"];
  canOpen: boolean;
}

function hasServiceEntries(
  servicesByProjectId: Record<string, RuntimeServiceInfo[]> | undefined,
): boolean {
  return Object.values(servicesByProjectId ?? {}).some(
    (services) => services.length > 0,
  );
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
        title: String(info.port),
        detail: `${projectNames?.[projectId] ?? "project"}${
          !(info.reachable ?? info.bindsAll) ? " - localhost only" : ""
        }`,
        canOpen: info.reachable ?? info.bindsAll,
      });
    }
  }
  return entries.sort((a, b) =>
    a.projectName === b.projectName
      ? a.port - b.port
      : a.projectName.localeCompare(b.projectName),
  );
}

function buildServiceEntries(
  servicesByProjectId: Record<string, RuntimeServiceInfo[]> | undefined,
  projectNames: Record<string, string> | undefined,
  sessions: Session[] | undefined,
): PortCenterEntry[] {
  const sessionsById = new Map((sessions ?? []).map((s) => [s.id, s]));
  const entries: PortCenterEntry[] = [];
  for (const [projectId, services] of Object.entries(
    servicesByProjectId ?? {},
  )) {
    for (const service of services ?? []) {
      const sessionId = service.attribution.sessionId;
      const session = sessionId ? sessionsById.get(sessionId) : undefined;
      const lifecycle = service.lifecycle;
      const reachable = service.reachable;
      const canOpen = reachable && lifecycle !== "disappeared";
      entries.push({
        key: service.id,
        port: service.port,
        projectId,
        projectName: projectNames?.[projectId] ?? "project",
        reachable,
        url: serviceUrl(service),
        title:
          service.serviceName ?? service.processName ?? String(service.port),
        detail: serviceDetail(service, projectNames?.[projectId], session),
        lifecycle,
        canOpen,
      });
    }
  }
  return entries.sort((a, b) =>
    a.projectName === b.projectName
      ? a.port - b.port || a.title.localeCompare(b.title)
      : a.projectName.localeCompare(b.projectName),
  );
}

function usePortCenterState(
  portsByProjectId: Record<string, PortInfo[]> | undefined,
  servicesByProjectId: Record<string, RuntimeServiceInfo[]> | undefined,
  projectNames: Record<string, string> | undefined,
  sessions: Session[] | undefined,
) {
  const initializedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [seenPortKeys, setSeenPortKeys] = useState<Set<string>>(
    () => new Set(),
  );
  const entries = useMemo(
    () =>
      hasServiceEntries(servicesByProjectId)
        ? buildServiceEntries(servicesByProjectId, projectNames, sessions)
        : buildPortEntries(portsByProjectId, projectNames),
    [portsByProjectId, projectNames, servicesByProjectId, sessions],
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
  servicesByProjectId,
  projectNames,
  sessions,
  onOpenUrl,
}: NetworkPortCenterProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const { entries, hasUnread, markCurrentSeen, open, setOpen } =
    usePortCenterState(
      portsByProjectId,
      servicesByProjectId,
      projectNames,
      sessions,
    );

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
                      {entry.title}
                      <span className="ml-1 text-text-secondary">
                        :{entry.port}
                      </span>
                    </div>
                    <div className="truncate text-xs text-text-secondary">
                      {entry.detail}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard?.writeText(entry.url);
                      }}
                      className="flex h-7 items-center rounded-control px-2 text-xs text-text-secondary hover:bg-row-hover-bg hover:text-text-primary"
                    >
                      Copy
                    </button>
                    <button
                      type="button"
                      disabled={!entry.canOpen || !onOpenUrl}
                      onClick={() => {
                        onOpenUrl?.(entry.url, { projectId: entry.projectId });
                        setOpen(false);
                      }}
                      className="flex h-7 items-center rounded-control px-2 text-xs text-accent hover:bg-row-hover-bg disabled:text-text-secondary disabled:opacity-50"
                    >
                      Open
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

function serviceUrl(service: RuntimeServiceInfo): string {
  if (service.advertisedUrl) return service.advertisedUrl.origin;
  const protocol = service.protocol === "https" ? "https" : "http";
  return `${protocol}://localhost:${service.port}`;
}

function serviceDetail(
  service: RuntimeServiceInfo,
  projectName: string | undefined,
  session: Session | undefined,
): string {
  const parts = [projectName ?? "project"];
  if (service.attribution.worktreePath) {
    parts.push(lastPathSegment(service.attribution.worktreePath));
  }
  if (session?.title) parts.push(session.title);
  if (service.lifecycle === "disappeared") parts.push("closed");
  else if (!service.reachable) {
    if (service.lifecycle === "forwarder-pending")
      parts.push("forwarder pending");
    else if (service.lifecycle === "forwarder-failed") {
      parts.push("forwarder failed");
    } else parts.push("localhost only");
  }
  return parts.join(" - ");
}

function lastPathSegment(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.split("/").pop() || path;
}
