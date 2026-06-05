import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import type { NetworkEndpoint, TailscaleStatus } from "../network/endpoints.js";
import { buildPairingUrl, buildQrSection } from "../network/qr.js";

interface QrResponse {
  ok: boolean;
  error?: string;
  port: number;
  token: string;
  tokenKind?: "auth" | "pairing";
  authMode: "token" | "allowlist" | "none";
  endpoints: NetworkEndpoint[];
  tailscaleStatus: TailscaleStatus;
  iface?: string;
}

export async function cliQr(args: string[]): Promise<void> {
  let iface: string | undefined;
  for (const arg of args) {
    if (arg.startsWith("--iface=")) iface = arg.slice(8);
    else if (arg === "-h" || arg === "--help") {
      console.log(
        "Usage: parasor qr [--iface=<iface>]\n" +
          "  Displays a QR code for a running parasor server. Defaults to Tailscale, falls back to LAN.",
      );
      return;
    }
  }

  const socketPath =
    process.env.PARASOR_SOCKET ??
    join(
      process.env.PARASOR_CONFIG_DIR ?? join(homedir(), ".config", "parasor"),
      "parasor.sock",
    );

  const response = await sendRequest(socketPath, {
    cmd: "qr",
    args: { iface: iface ?? "" },
  });

  if (!response.ok) {
    console.error(`parasor qr failed: ${response.error ?? "unknown error"}`);
    process.exit(1);
  }

  const lines = buildQrSection({
    endpoints: response.endpoints,
    port: response.port,
    authMode: response.authMode,
    token: response.token,
    makeAccessUrl:
      response.authMode === "token" && response.tokenKind === "pairing"
        ? (endpoint) =>
            buildPairingUrl(endpoint.address, response.port, response.token)
        : undefined,
    iface: iface ?? response.iface,
    clickable: process.stdout.isTTY === true,
  });
  for (const line of lines) console.log(line);
}

function sendRequest(
  socketPath: string,
  request: { cmd: string; args: Record<string, unknown> },
): Promise<QrResponse> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      client.write(`${JSON.stringify(request)}\n`);
    });
    let data = "";
    client.on("data", (chunk) => {
      data += chunk;
    });
    client.on("end", () => {
      try {
        resolve(JSON.parse(data.trim()) as QrResponse);
      } catch (err) {
        reject(err);
      }
    });
    client.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        reject(
          new Error(
            `No parasor server reachable at ${socketPath}. Start it with \`parasor\` first.`,
          ),
        );
      } else {
        reject(err);
      }
    });
    client.setTimeout(2000, () => {
      client.destroy(new Error("timeout"));
    });
  });
}
