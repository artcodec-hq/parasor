import type { FormEvent, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePaneFocusHandler } from "../../../hooks/usePaneFocusHandler.js";
import { isCoarsePointer } from "../../../lib/pointer.js";

interface BrowserPaneProps {
  url: string;
  onUrlChange?: (url: string) => void;
  paneId?: string;
  headerActions?: ReactNode;
}

const BLANK_URL = "about:blank";

function displayUrlForInput(url: string): string {
  return url === BLANK_URL ? "" : url;
}

export function BrowserPane({
  url,
  onUrlChange,
  paneId,
  headerActions,
}: BrowserPaneProps) {
  const [inputUrl, setInputUrl] = useState(displayUrlForInput(url));
  const [currentUrl, setCurrentUrl] = useState(url);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setCurrentUrl(url);
    setInputUrl(displayUrlForInput(url));
  }, [url]);

  // Cross-origin iframes silently no-op; that's fine.
  const focusPane = useCallback(() => {
    iframeRef.current?.contentWindow?.focus();
  }, []);
  usePaneFocusHandler(paneId, focusPane, !isCoarsePointer());

  function navigate(targetUrl: string) {
    let normalized = targetUrl.trim();
    if (normalized === "") {
      setInputUrl(displayUrlForInput(currentUrl));
      return;
    }
    if (normalized === BLANK_URL) {
      normalized = BLANK_URL;
    } else if (!/^https?:\/\//i.test(normalized)) {
      normalized = `https://${normalized}`;
    }
    setCurrentUrl(normalized);
    setInputUrl(displayUrlForInput(normalized));
    onUrlChange?.(normalized);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    navigate(inputUrl);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Address bar */}
      <form
        onSubmit={handleSubmit}
        aria-label="Browser address bar"
        className="flex items-center gap-2 border-b border-border bg-bg-primary px-2 py-1"
      >
        <button
          type="button"
          onClick={() => iframeRef.current?.contentWindow?.history.back()}
          aria-label="Browser back"
          className="text-text-secondary hover:text-text-primary text-sm px-1"
          title="Back"
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => iframeRef.current?.contentWindow?.history.forward()}
          aria-label="Browser forward"
          className="text-text-secondary hover:text-text-primary text-sm px-1"
          title="Forward"
        >
          {"->"}
        </button>
        <button
          type="button"
          onClick={() => iframeRef.current?.contentWindow?.location.reload()}
          aria-label="Browser reload"
          className="text-text-secondary hover:text-text-primary text-sm px-1"
          title="Reload"
        >
          ↻
        </button>
        <input
          type="text"
          aria-label="URL"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          className="flex-1 rounded-control bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:ring-1 focus:ring-accent"
          placeholder="URL"
        />
        {headerActions}
      </form>

      {/* iframe */}
      <iframe
        ref={iframeRef}
        src={currentUrl}
        className="flex-1 border-none bg-white"
        sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
        title="Browser"
      />
    </div>
  );
}
