import type { ServerNotice, ServerNoticesResponse } from "@parasor/shared";
import { useCallback, useEffect, useState } from "react";
import { authFetch } from "../../lib/auth-fetch.js";
import { PaButton } from "../primitives/index.js";

/*
 * Surfaces server-lifetime notices recorded by the createPtyHost recovery
 * path. The canonical case is `daemon-auto-restarted`: the server
 * detected an incompatible PTY-host daemon, terminated it, spawned a
 * fresh one, and resumed boot. Active PTY sessions died in that
 * transition; this banner tells the (often non-technical) user why the
 * session list is empty after an upgrade rather than letting them stare
 * at a blank UI and assume parasor is broken.
 *
 * Visual: thin top-of-screen strip in the warn tone, dismissable. The
 * server-side store is in-memory only, so dismissal does not need to
 * survive server restarts (a fresh server lifetime starts with no
 * notices either way).
 */
export function ServerNoticesBanner() {
  const [notices, setNotices] = useState<ServerNotice[]>([]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch("/api/notices");
        if (!res.ok) return;
        const body = (await res.json()) as ServerNoticesResponse;
        if (!cancelled) setNotices(body.notices ?? []);
      } catch {
        /* offline / not yet ready -- banner just stays hidden */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(async (kind: ServerNotice["kind"]) => {
    setNotices((current) => current.filter((n) => n.kind !== kind));
    try {
      await authFetch(`/api/notices/${kind}`, { method: "DELETE" });
    } catch {
      /* best-effort; banner is gone client-side regardless */
    }
  }, []);

  if (notices.length === 0) return null;

  return (
    <div className="flex flex-col">
      {notices.map((notice) => (
        <ServerNoticeRow
          key={notice.kind}
          notice={notice}
          onDismiss={() => void dismiss(notice.kind)}
        />
      ))}
    </div>
  );
}

function ServerNoticeRow({
  notice,
  onDismiss,
}: {
  notice: ServerNotice;
  onDismiss: () => void;
}) {
  const text = renderNoticeText(notice);
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-border bg-warning/10 px-4 py-2 text-sm text-text-primary"
    >
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-warning" />
      <p className="flex-1 leading-snug">{text}</p>
      <PaButton kind="dismiss" size="sm" onClick={onDismiss}>
        Dismiss
      </PaButton>
    </div>
  );
}

function renderNoticeText(notice: ServerNotice): string {
  switch (notice.kind) {
    case "daemon-auto-restarted":
      return (
        "セッションがリセットされました -- parasor が新しいバージョンに更新されたため、" +
        "走行中だったターミナルセッションは終了しています。"
      );
  }
}
