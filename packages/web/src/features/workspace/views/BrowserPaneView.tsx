import type { BrowserPaneState } from "@parasor/shared";
import { BrowserPane } from "../../panes/browser/BrowserPane.js";
import { PaneCloseButton } from "./PaneCloseButton.js";

interface BrowserPaneViewProps {
  state: BrowserPaneState;
  onUrlChange?: (url: string) => void;
  paneId?: string;
  onClose?: () => void;
}

export function BrowserPaneView({
  state,
  onUrlChange,
  paneId,
  onClose,
}: BrowserPaneViewProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="min-h-0 flex-1">
        <BrowserPane
          url={state.url}
          onUrlChange={onUrlChange}
          paneId={paneId}
          headerActions={onClose ? <PaneCloseButton onClick={onClose} /> : null}
        />
      </div>
    </div>
  );
}
