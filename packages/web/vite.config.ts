import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { createLogger, defineConfig } from "vite";

/*
 * Dev backend discovery: the Hono server writes its actual listening port to
 * ~/.config/parasor/runtime.json after it picks one (possibly auto-bumped
 * when the default 7681 is taken by something else). We re-read that file
 * on proxy requests so Vite follows the backend even when its port drifts
 * between restarts. Falls back to 7681 if the file is missing or stale.
 */
const RUNTIME_FILE = join(
  process.env.PARASOR_CONFIG_DIR ?? join(homedir(), ".config", "parasor"),
  "runtime.json",
);

let cachedBackendUrl: { url: string; at: number } | null = null;

function resolveBackendUrl(): string {
  // Debounce to at most once per second so bursty requests don't re-read.
  const now = Date.now();
  if (cachedBackendUrl && now - cachedBackendUrl.at < 1000) {
    return cachedBackendUrl.url;
  }
  let url = "http://127.0.0.1:7681";
  try {
    const raw = readFileSync(RUNTIME_FILE, "utf-8");
    const parsed = JSON.parse(raw) as { port?: number; pid?: number };
    if (typeof parsed.port === "number") {
      // Stale-pid check: if the recorded pid no longer exists, fall back to
      // the default port instead of proxying to a dead process.
      let alive = true;
      if (typeof parsed.pid === "number") {
        try {
          process.kill(parsed.pid, 0);
        } catch {
          alive = false;
        }
      }
      if (alive) url = `http://127.0.0.1:${parsed.port}`;
    }
  } catch {
    // File missing or unreadable -- keep default.
  }
  cachedBackendUrl = { url, at: now };
  return url;
}

const logger = createLogger();
const originalError = logger.error.bind(logger);
const benignPatterns = [
  /ws proxy (?:socket )?error/i,
  /EPIPE/,
  /ECONNRESET/,
  /ECONNABORTED/,
];
logger.error = (msg, opts) => {
  if (typeof msg === "string" && benignPatterns.some((p) => p.test(msg)))
    return;
  originalError(msg, opts);
};

function readPortEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const port = Number(raw);
  return Number.isSafeInteger(port) && port > 0 && port <= 65535
    ? port
    : fallback;
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  customLogger: logger,
  server: {
    host: true,
    allowedHosts: [".ts.net"],
    port: readPortEnv("WEB_PORT", 7683),
    strictPort: true,
    proxy: {
      "/api": {
        target: resolveBackendUrl(),
        changeOrigin: true,
      },
      "/ws": {
        target: resolveBackendUrl(),
        ws: true,
        changeOrigin: true,
        /*
         * Keep the websocket proxy on the concrete HTTP backend URL chosen
         * at dev-server startup. Vite's dynamic `router` path works for our
         * HTTP API proxy, but the websocket upgrade path can hang behind it,
         * which leaves both /ws/events and /ws/terminal inert in dev.
         *
         * Rewrite Origin on the outgoing WS upgrade so parasor's Origin
         * allowlist sees its own bind origin instead of the browser-side
         * Vite origin (:7683 or Tailnet IP:7683). This keeps the
         * production Origin check strict while allowing the dev proxy.
         */
        configure: (proxy) => {
          proxy.on("proxyReqWs", (proxyReq) => {
            proxyReq.setHeader("origin", resolveBackendUrl());
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    modulePreload: false,
  },
});
