import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { AuthGate } from "./components/overlays/AuthGate.js";
import { SettingsProvider } from "./features/settings/index.js";
import { scheduleClientStartupDiagnosticCapture } from "./lib/terminal-trace.js";
import "./app.css";

/*
 * Symbols Nerd Font is lazy-loaded: the browser only fetches the woff2 when
 * a Nerd-Font glyph actually enters a layout box (Powerline prompt, k9s,
 * etc.). Terminals that never see such a glyph pay zero bytes for it,
 * which matters on cellular/mobile. Terminal.tsx subscribes to
 * document.fonts `loadingdone` to rebuild xterm's WebGL glyph atlas so the
 * freshly-loaded font replaces the tofu placeholder the atlas was baked
 * with during the first render.
 */

/*
 * iOS Safari ignores `user-scalable=no` since iOS 10 (accessibility decision),
 * so the viewport meta alone doesn't stop pinch-zoom -- the terminal grid warps
 * and xterm's fit addon can't recover until the user double-taps to reset.
 *
 * WebKit's non-standard `gesturestart` fires at the beginning of any two-
 * finger gesture; preventing it blocks pinch-zoom at the page level on both
 * iOS and desktop Safari. Other browsers never dispatch these events so the
 * listeners are no-ops elsewhere.
 */
const preventGesture = (event: Event) => event.preventDefault();
document.addEventListener("gesturestart", preventGesture);
document.addEventListener("gesturechange", preventGesture);
document.addEventListener("gestureend", preventGesture);

interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
}

/*
 * Without an ErrorBoundary, an uncaught render-time exception unmounts the
 * entire React tree and leaves only the body/#root background visible -- the
 * "screen goes blank" symptom that's nearly impossible to diagnose remotely
 * (especially on iOS Safari where devtools aren't readily available). This
 * boundary is a permanent safety net: any caught error is rendered as plain
 * text on top of everything so it can be read on the device that hit it.
 */
class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info });
    console.error("[parasor ErrorBoundary]", error, info);
    scheduleClientStartupDiagnosticCapture("react-error-boundary", {
      type: "react-error-boundary",
      status: error.name,
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "#000",
            color: "#fff",
            padding: 16,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            overflow: "auto",
            zIndex: 2147483647,
          }}
        >
          <div style={{ color: "#ff5555", fontSize: 14, marginBottom: 8 }}>
            ⚠ React error caught
          </div>
          <div style={{ color: "#ffaa00", marginBottom: 8 }}>
            {this.state.error.name}: {this.state.error.message}
          </div>
          <pre style={{ whiteSpace: "pre-wrap", color: "#aaa", fontSize: 10 }}>
            {this.state.error.stack}
          </pre>
          {this.state.info && (
            <pre
              style={{
                whiteSpace: "pre-wrap",
                color: "#666",
                fontSize: 10,
                marginTop: 8,
              }}
            >
              {this.state.info.componentStack}
            </pre>
          )}
          <button
            type="button"
            onClick={() => this.setState({ error: null, info: null })}
            style={{
              marginTop: 12,
              padding: "6px 12px",
              background: "#2f81f7",
              color: "#fff",
              border: 0,
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById("root");
if (!rootElement) throw new Error("Missing #root element");

createRoot(rootElement).render(
  <ErrorBoundary>
    <SettingsProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </SettingsProvider>
  </ErrorBoundary>,
);
