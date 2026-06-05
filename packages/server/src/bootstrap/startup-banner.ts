import { join } from "node:path";
import type { NetworkEndpoint, TailscaleStatus } from "../network/endpoints.js";
import { buildAuthUrl, buildQrSection } from "../network/qr.js";
import type { AuthMode } from "./create-app-server.js";

export interface QrOptions {
  enabled: boolean;
  iface?: string;
}

export interface BindInfo {
  /** True when the user passed `--host` (or `HOST=`); false on the default. */
  explicit: boolean;
  host: string;
}

interface BuildStartupBannerOptions {
  authMode: AuthMode;
  configDir: string;
  endpoints: NetworkEndpoint[];
  port: number;
  tailscaleStatus: TailscaleStatus;
  token?: string;
  makeAccessUrl?: (endpoint: NetworkEndpoint) => string;
  qr?: QrOptions;
  bind?: BindInfo;
  /**
   * When true, wrap URLs in OSC 8 hyperlinks so terminals that support it
   * render them as a single clickable region -- even after the line wraps.
   * `right click -> Copy link` then yields the full URL without injected
   * newlines, which is the failure mode that makes a wrapped `?t=<token>`
   * URL useless to copy/paste.
   */
  clickable?: boolean;
}

const OSC8_START = "\x1b]8;;";
const OSC8_DELIM = "\x1b\\";
const OSC8_END = "\x1b]8;;\x1b\\";

/*
 * OSC 8 hyperlinks delimit the URL with `ESC \` (ST) and start with `ESC ]
 * 8 ;;`. Any control character in the URL or label can break or hijack the
 * sequence, so refuse to wrap when one is present and emit the plain text
 * instead. `NetworkEndpoint.address` is OS-sourced today and unlikely to
 * carry such bytes, but the function is exported and re-used for QR
 * fallback paths, so the check stays defensive.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC8 labels/URLs must reject terminal control bytes.
const TERMINAL_CONTROL_RE = /[\x00-\x1f\x7f]/;

function hyperlink(url: string, label: string, clickable: boolean): string {
  if (!clickable) return label;
  if (TERMINAL_CONTROL_RE.test(url) || TERMINAL_CONTROL_RE.test(label)) {
    return label;
  }
  return `${OSC8_START}${url}${OSC8_DELIM}${label}${OSC8_END}`;
}

/**
 * Filter endpoints to those actually reachable given the bind host.
 *
 * `0.0.0.0` / `::` (the default) listens on every interface, so all endpoints
 * stay. A specific host (loopback, LAN IP, Tailscale CGNAT) is single-bind --
 * only that address is reachable. MagicDNS rides along when the bind matches
 * the Tailscale endpoint, since the friendly hostname resolves to it.
 */
function filterReachableEndpoints(
  endpoints: NetworkEndpoint[],
  bind: BindInfo | undefined,
): NetworkEndpoint[] {
  if (!bind) return endpoints;
  const { host } = bind;
  if (host === "0.0.0.0" || host === "::" || host === "::0") return endpoints;
  const tailscaleHostMatch = endpoints.some(
    (e) => e.address === host && e.category === "Tailscale",
  );
  return endpoints.filter((e) => {
    if (e.address === host) return true;
    if (e.iface === "MagicDNS" && tailscaleHostMatch) return true;
    return false;
  });
}

function buildDefaultAccessUrl(
  endpoint: NetworkEndpoint,
  port: number,
  authMode: AuthMode,
  token: string | undefined,
): string {
  if (authMode === "token" && !token) {
    throw new Error("token or makeAccessUrl is required for token auth URLs");
  }
  return buildAuthUrl(endpoint.address, port, authMode, token ?? "");
}

export function buildStartupBanner({
  authMode,
  configDir,
  endpoints,
  port,
  tailscaleStatus,
  token,
  makeAccessUrl,
  qr,
  bind,
  clickable = false,
}: BuildStartupBannerOptions): string[] {
  const lines: string[] = [];

  lines.push(``, `parasor running on port ${port}`, ``, "Access URLs:");

  const visibleEndpoints = filterReachableEndpoints(endpoints, bind);
  for (const endpoint of visibleEndpoints) {
    const authUrl =
      makeAccessUrl?.(endpoint) ??
      buildDefaultAccessUrl(endpoint, port, authMode, token);
    const label = endpoint.iface
      ? `${endpoint.category} (${endpoint.iface})`
      : endpoint.category;
    /*
     * URL goes on its own line so a terminal that wraps a long
     * `?t=<64-hex>` URL still puts the whole token on a single visual row
     * (or at least a wrap that the OS clipboard can handle). Inline
     * `label  url` was prone to copy-paste truncation when the URL wrapped
     * across two terminal columns.
     */
    lines.push(`  ${label}`);
    lines.push(`    ${hyperlink(authUrl, authUrl, clickable)}`);
  }

  if (tailscaleStatus.state === "stopped") {
    lines.push(
      "",
      "  Tailscale is installed but not running. Run `tailscale up` for remote access.",
    );
  }

  if (authMode === "token") {
    lines.push("", `Auth: token (saved to ${join(configDir, "token")})`);
  } else if (authMode === "none") {
    lines.push("", "Auth: none (trusted network mode)");
  }

  if (bind && !bind.explicit && bind.host === "0.0.0.0") {
    lines.push(
      "",
      "Tip: bind to loopback only with `parasor --host 127.0.0.1`",
    );
  }

  if (qr?.enabled) {
    lines.push("");
    for (const row of buildQrSection({
      endpoints: visibleEndpoints,
      port,
      authMode,
      token,
      makeAccessUrl,
      iface: qr.iface,
      clickable,
    })) {
      lines.push(row);
    }
  }

  lines.push("");
  return lines;
}

export function printStartupBanner(
  options: BuildStartupBannerOptions,
  log: (line: string) => void = console.log,
): void {
  /*
   * Default `clickable` to TTY detection so OSC 8 escape sequences only go
   * to interactive terminals -- log files / piped output stay plain text.
   */
  const resolved: BuildStartupBannerOptions =
    options.clickable === undefined
      ? { ...options, clickable: process.stdout.isTTY === true }
      : options;
  for (const line of buildStartupBanner(resolved)) {
    log(line);
  }
}
