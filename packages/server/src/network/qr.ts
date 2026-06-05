import qrcodeTerminal from "qrcode-terminal";
import type { NetworkEndpoint } from "./endpoints.js";

// macOS virtual / ephemeral interfaces we never want to surface to a phone.
const VIRTUAL_IFACE_RE = /^(bridge|awdl|llw|anpi|ap|pktap|gif|stf)/;

export function selectQrEndpoint(
  endpoints: NetworkEndpoint[],
  iface?: string,
): NetworkEndpoint | undefined {
  if (iface) {
    return endpoints.find((e) => e.iface === iface);
  }
  const tailscale = endpoints.find((e) => e.category === "Tailscale");
  if (tailscale) return tailscale;
  return endpoints.find(
    (e) =>
      e.category === "LAN" && (!e.iface || !VIRTUAL_IFACE_RE.test(e.iface)),
  );
}

export function buildAuthUrl(
  address: string,
  port: number,
  authMode: "token" | "allowlist" | "none",
  token: string,
): string {
  const base = `http://${address}:${port}`;
  return authMode === "token" ? `${base}/?t=${token}` : base;
}

export function buildPairingUrl(
  address: string,
  port: number,
  token: string,
  path = "/",
): string {
  const url = new URL(`http://${address}:${port}${normalizeAccessPath(path)}`);
  url.searchParams.set("t", token);
  return url.toString();
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: access paths must reject terminal/header control bytes.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

function normalizeAccessPath(path: string): string {
  if (
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    CONTROL_CHAR_RE.test(path)
  ) {
    throw new Error("access URL path must be same-origin relative");
  }
  return path;
}

function buildDefaultAccessUrl(
  address: string,
  port: number,
  authMode: "token" | "allowlist" | "none",
  token: string | undefined,
): string {
  if (authMode === "token" && !token) {
    throw new Error("token or makeAccessUrl is required for token auth URLs");
  }
  return buildAuthUrl(address, port, authMode, token ?? "");
}

export function renderQrLines(url: string): string[] {
  let output = "";
  qrcodeTerminal.generate(url, { small: true }, (rendered) => {
    output = rendered;
  });
  return output.replace(/\n$/, "").split("\n");
}

export interface QrSectionOptions {
  endpoints: NetworkEndpoint[];
  port: number;
  authMode: "token" | "allowlist" | "none";
  token?: string;
  makeAccessUrl?: (endpoint: NetworkEndpoint) => string;
  iface?: string;
  clickable?: boolean;
}

/*
 * OSC 8 hyperlink. Refuse to wrap when the URL or label contains a
 * terminal control character, since those would break the escape
 * sequence (and could be used to inject other escapes if the input is
 * untrusted).
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: OSC8 labels/URLs must reject terminal control bytes.
const TERMINAL_CONTROL_RE = /[\x00-\x1f\x7f]/;
const OSC8_HYPERLINK = (url: string, label: string): string => {
  if (TERMINAL_CONTROL_RE.test(url) || TERMINAL_CONTROL_RE.test(label)) {
    return label;
  }
  return `\x1b]8;;${url}\x1b\\${label}\x1b]8;;\x1b\\`;
};

export function buildQrSection({
  endpoints,
  port,
  authMode,
  token,
  makeAccessUrl,
  iface,
  clickable = false,
}: QrSectionOptions): string[] {
  const target = selectQrEndpoint(endpoints, iface);
  if (!target) {
    if (iface) {
      const candidates = endpoints
        .map((e) => e.iface)
        .filter(Boolean)
        .join(", ");
      return [
        `QR: interface "${iface}" not found. Available: ${candidates || "(none)"}`,
      ];
    }
    return [
      "QR: no remote endpoint detected. Run `tailscale up` or connect to a LAN.",
    ];
  }
  const url =
    makeAccessUrl?.(target) ??
    buildDefaultAccessUrl(target.address, port, authMode, token);
  const label = target.iface
    ? `${target.category} (${target.iface})`
    : target.category;
  const linkedUrl = clickable ? OSC8_HYPERLINK(url, url) : url;
  return [
    `Scan to open on mobile -- ${label}`,
    `  ${linkedUrl}`,
    "",
    ...renderQrLines(url),
  ];
}
