import { execFile } from "node:child_process";
import type { NetworkInterfaceInfo } from "node:os";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NetworkEndpoint {
  category: "Local" | "LAN" | "Tailscale" | "VPN";
  address: string;
  iface?: string;
}

export interface TailscaleStatus {
  state: "running" | "stopped" | "not-installed";
  magicDNS?: string;
}

const VPN_IFACE_RE = /^(utun|tun|ppp|ipsec|wg)/;

function isCGNAT(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isRFC1918(addr: string): boolean {
  const parts = addr.split(".").map(Number);
  if (parts[0] === 10) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  return false;
}

export function classifyInterfaces(
  ifaces?: Record<string, NetworkInterfaceInfo[]>,
): NetworkEndpoint[] {
  const raw = ifaces ?? networkInterfaces();
  const endpoints: NetworkEndpoint[] = [
    { category: "Local", address: "127.0.0.1" },
  ];

  for (const [name, addrs] of Object.entries(raw)) {
    if (!addrs) continue;
    for (const info of addrs) {
      if (info.internal || info.family !== "IPv4") continue;

      // Tailscale: CGNAT range or tailscale0 interface
      if (isCGNAT(info.address) || name === "tailscale0") {
        endpoints.push({
          category: "Tailscale",
          address: info.address,
          iface: name,
        });
        continue;
      }

      // VPN: utun/tun/ppp/ipsec/wg interface with non-CGNAT address
      if (VPN_IFACE_RE.test(name)) {
        endpoints.push({ category: "VPN", address: info.address, iface: name });
        continue;
      }

      // LAN: RFC1918
      if (isRFC1918(info.address)) {
        endpoints.push({ category: "LAN", address: info.address, iface: name });
      }
    }
  }

  return endpoints;
}

function extractMagicDNS(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const self = (data as { Self?: { DNSName?: unknown } }).Self;
  const dnsName = self?.DNSName;
  if (typeof dnsName !== "string" || dnsName.length === 0) return undefined;
  return dnsName.replace(/\.$/, "");
}

export async function checkTailscale(): Promise<TailscaleStatus> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["status", "--json"], {
      timeout: 3000,
    });
    const data = JSON.parse(stdout);
    if (data.BackendState !== "Running") return { state: "stopped" };
    const magicDNS = extractMagicDNS(data);
    return magicDNS ? { state: "running", magicDNS } : { state: "running" };
  } catch (err: unknown) {
    const isNotFound =
      err instanceof Error &&
      ("code" in err
        ? (err as NodeJS.ErrnoException).code === "ENOENT"
        : false);
    if (isNotFound) return { state: "not-installed" };
    return { state: "stopped" };
  }
}

export function withMagicDNS(
  endpoints: NetworkEndpoint[],
  magicDNS: string | undefined,
): NetworkEndpoint[] {
  if (!magicDNS) return endpoints;
  const entry: NetworkEndpoint = {
    category: "Tailscale",
    address: magicDNS,
    iface: "MagicDNS",
  };
  const result: NetworkEndpoint[] = [];
  let inserted = false;
  for (const e of endpoints) {
    result.push(e);
    if (!inserted && e.category === "Tailscale" && e.iface !== "MagicDNS") {
      result.push(entry);
      inserted = true;
    }
  }
  if (!inserted) result.push(entry);
  return result;
}
