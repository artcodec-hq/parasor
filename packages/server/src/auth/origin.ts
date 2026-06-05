import type { NetworkInterfaceInfo } from "node:os";
import { networkInterfaces } from "node:os";
import type { MiddlewareHandler } from "hono";

export function normalizeOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    const scheme = url.protocol.replace(":", "");
    let host = url.hostname.toLowerCase();
    if (host.includes(":") && !host.startsWith("[")) host = `[${host}]`;
    const defaultPort = scheme === "http" ? "80" : "443";
    const port = url.port && url.port !== defaultPort ? `:${url.port}` : "";
    return `${scheme}://${host}${port}`;
  } catch {
    return null;
  }
}

export function parseAllowedOriginsEnv(raw: string | undefined): string[] {
  if (!raw) return [];
  const out: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const normalized = normalizeOrigin(trimmed);
    if (normalized) out.push(normalized);
  }
  return out;
}

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);

export interface BuildAllowedOriginsOptions {
  bindHost: string;
  port: number;
  extra: string[];
  protocol?: "http" | "https";
  ifaces?: Record<string, NetworkInterfaceInfo[] | undefined>;
}

function isIPv6LinkLocal(addr: string): boolean {
  return addr.toLowerCase().startsWith("fe80:");
}

function formatHost(address: string, family: "IPv4" | "IPv6"): string {
  if (family === "IPv6") return `[${address}]`;
  return address;
}

export function buildAllowedOrigins({
  bindHost,
  port,
  extra,
  protocol = "http",
  ifaces,
}: BuildAllowedOriginsOptions): Set<string> {
  const set = new Set<string>();
  const add = (raw: string) => {
    const n = normalizeOrigin(raw);
    if (n) set.add(n);
  };
  add(`${protocol}://127.0.0.1:${port}`);
  add(`${protocol}://localhost:${port}`);
  add(`${protocol}://[::1]:${port}`);
  if (WILDCARD_HOSTS.has(bindHost)) {
    // Wildcard bind reaches every non-internal interface address. Seed each
    // into the allowlist so browser Origin headers from LAN/VPN/Tailscale
    // clients are accepted without forcing users to set PARASOR_ALLOWED_ORIGINS.
    const raw = ifaces ?? networkInterfaces();
    for (const addrs of Object.values(raw)) {
      if (!addrs) continue;
      for (const info of addrs) {
        if (info.internal) continue;
        if (info.family !== "IPv4" && info.family !== "IPv6") continue;
        if (info.family === "IPv6" && isIPv6LinkLocal(info.address)) continue;
        add(`${protocol}://${formatHost(info.address, info.family)}:${port}`);
      }
    }
  } else {
    const host =
      bindHost.includes(":") && !bindHost.startsWith("[")
        ? `[${bindHost}]`
        : bindHost;
    add(`${protocol}://${host}:${port}`);
  }
  for (const e of extra) add(e);
  return set;
}

export interface OriginMiddlewareOptions {
  allowed: Set<string>;
}

export function originMiddleware({
  allowed,
}: OriginMiddlewareOptions): MiddlewareHandler {
  return async (c, next) => {
    const origin = c.req.header("origin") ?? c.req.header("Origin");
    if (!origin) return next();
    const normalized = normalizeOrigin(origin);
    if (!normalized || !allowed.has(normalized)) {
      return c.text("Forbidden", 403);
    }
    return next();
  };
}
