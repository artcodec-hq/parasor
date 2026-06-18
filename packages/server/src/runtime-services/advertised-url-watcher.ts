import type {
  RuntimeServiceAdvertisedUrl,
  RuntimeServiceInfo,
} from "@parasor/shared";

const DEFAULT_BUFFER_LIMIT = 4096;
const DEFAULT_PENDING_RETENTION_MS = 30_000;
const URL_PATTERN = /https?:\/\/[^\s<>"'`\\\])}]+/gi;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal ANSI stripping requires matching ESC control bytes.
const ANSI_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal OSC stripping requires matching ESC/BEL control bytes.
const OSC_PATTERN = /\x1b\][\s\S]*?(?:\x07|\x1b\\)/g;

export interface AdvertisedUrlSessionBinding {
  projectId: string;
  worktreePath: string;
}

export interface RuntimeServiceAdvertisedUrlWatcherOptions {
  bufferLimit?: number;
  pendingRetentionMs?: number;
}

export class RuntimeServiceAdvertisedUrlWatcher {
  private readonly bufferLimit: number;
  private readonly pendingRetentionMs: number;
  private readonly buffers = new Map<string, string>();
  private readonly candidates = new Map<
    string,
    RuntimeServiceAdvertisedUrl[]
  >();
  private onChanged: ((projectId: string) => void) | null = null;

  constructor(options: RuntimeServiceAdvertisedUrlWatcherOptions = {}) {
    this.bufferLimit = options.bufferLimit ?? DEFAULT_BUFFER_LIMIT;
    this.pendingRetentionMs =
      options.pendingRetentionMs ?? DEFAULT_PENDING_RETENTION_MS;
  }

  setOnChanged(callback: (projectId: string) => void): void {
    this.onChanged = callback;
  }

  feed(
    sessionId: string,
    data: string,
    binding: AdvertisedUrlSessionBinding | undefined,
    now = Date.now(),
  ): void {
    if (!binding?.worktreePath) return;
    const previous = this.buffers.get(sessionId) ?? "";
    const text = stripTerminalControls(previous + data);
    this.buffers.set(sessionId, text.slice(-this.bufferLimit));

    for (const raw of text.matchAll(URL_PATTERN)) {
      const advertised = normalizeAdvertisedUrl(raw[0], sessionId, now);
      if (!advertised) continue;
      const key = cacheKey(
        binding.projectId,
        binding.worktreePath,
        portForUrl(advertised),
      );
      const existing = this.candidates.get(key) ?? [];
      const changed = !existing.some(
        (candidate) => candidate.origin === advertised.origin,
      );
      this.candidates.set(key, preferAdvertisedUrls([...existing, advertised]));
      if (changed) this.onChanged?.(binding.projectId);
    }
  }

  applyToService(service: RuntimeServiceInfo): RuntimeServiceInfo {
    if (service.kind !== "workspace" || !service.attribution.worktreePath) {
      return service;
    }
    const key = cacheKey(
      service.attribution.projectId ?? "",
      service.attribution.worktreePath,
      service.port,
    );
    const candidates = this.candidates.get(key);
    if (candidates && service.pid !== null) {
      const valid = candidates.filter(
        (candidate) =>
          candidate.validatedListenerPid === undefined ||
          candidate.validatedListenerPid === service.pid,
      );
      if (valid.length !== candidates.length) {
        if (valid.length === 0) this.candidates.delete(key);
        else this.candidates.set(key, valid);
      }
    }
    const advertised = candidates?.find((candidate) =>
      candidateMatchesService(candidate, service),
    );
    if (!advertised) return service;
    const validated = {
      ...advertised,
      ...(service.pid !== null ? { validatedListenerPid: service.pid } : {}),
    };
    this.candidates.set(
      key,
      preferAdvertisedUrls([
        validated,
        ...(this.candidates.get(key) ?? []).filter(
          (candidate) => candidate.origin !== validated.origin,
        ),
      ]),
    );
    return { ...service, advertisedUrl: validated };
  }

  reconcile(services: RuntimeServiceInfo[], now = Date.now()): void {
    const live = new Set<string>();
    for (const service of services) {
      if (
        service.lifecycle === "disappeared" ||
        service.kind !== "workspace" ||
        !service.attribution.worktreePath
      ) {
        continue;
      }
      live.add(
        cacheKey(
          service.attribution.projectId ?? "",
          service.attribution.worktreePath,
          service.port,
        ),
      );
    }
    for (const [key, urls] of this.candidates) {
      if (live.has(key)) continue;
      const keepPending = urls.filter(
        (url) =>
          url.validatedListenerPid === undefined &&
          now - url.capturedAt <= this.pendingRetentionMs,
      );
      if (keepPending.length === 0) this.candidates.delete(key);
      else this.candidates.set(key, keepPending);
    }
  }

  removeSession(sessionId: string): void {
    this.buffers.delete(sessionId);
    for (const [key, urls] of this.candidates) {
      const next = urls.filter((url) => url.sourceSessionId !== sessionId);
      if (next.length === 0) this.candidates.delete(key);
      else this.candidates.set(key, next);
    }
  }
}

export function normalizeAdvertisedUrl(
  raw: string,
  sourceSessionId: string,
  capturedAt: number,
): RuntimeServiceAdvertisedUrl | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = normalizeHost(url.hostname);
  if (!host || host === "*" || host === "0.0.0.0" || host === "::") {
    return null;
  }
  const origin = `${url.protocol}//${formatHostForOrigin(host)}${url.port ? `:${url.port}` : ""}`;
  return {
    origin,
    protocol: url.protocol === "https:" ? "https" : "http",
    host,
    hostKind: classifyHost(host),
    sourceSessionId,
    capturedAt,
  };
}

export function stripTerminalControls(input: string): string {
  return input.replace(OSC_PATTERN, "").replace(ANSI_PATTERN, "");
}

function candidateMatchesService(
  advertised: RuntimeServiceAdvertisedUrl,
  service: RuntimeServiceInfo,
): boolean {
  const port = portForUrl(advertised);
  if (port !== service.port) return false;
  if (
    advertised.validatedListenerPid !== undefined &&
    service.pid !== null &&
    advertised.validatedListenerPid !== service.pid
  ) {
    return false;
  }
  return true;
}

function preferAdvertisedUrls(
  urls: RuntimeServiceAdvertisedUrl[],
): RuntimeServiceAdvertisedUrl[] {
  return urls
    .sort((a, b) => scoreAdvertisedUrl(b) - scoreAdvertisedUrl(a))
    .slice(0, 8);
}

function scoreAdvertisedUrl(url: RuntimeServiceAdvertisedUrl): number {
  const hostScore =
    url.hostKind === "custom"
      ? 400
      : url.hostKind === "loopback"
        ? 300
        : url.hostKind === "private-ip"
          ? 200
          : 100;
  const protocolScore = url.protocol === "https" ? 10 : 0;
  return (
    hostScore + protocolScore + Math.min(url.capturedAt / 1_000_000_000, 1)
  );
}

function portForUrl(url: RuntimeServiceAdvertisedUrl): number {
  const parsed = new URL(url.origin);
  if (parsed.port) return Number.parseInt(parsed.port, 10);
  return url.protocol === "https" ? 443 : 80;
}

function cacheKey(
  projectId: string,
  worktreePath: string,
  port: number,
): string {
  return `${projectId}\0${worktreePath}\0${port}`;
}

function normalizeHost(host: string): string {
  return host.replace(/^\[|\]$/g, "").toLowerCase();
}

function formatHostForOrigin(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function classifyHost(host: string): RuntimeServiceAdvertisedUrl["hostKind"] {
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") {
    return "loopback";
  }
  if (isPrivateIp(host)) return "private-ip";
  if (isIp(host)) return "public-ip";
  return "custom";
}

function isIp(host: string): boolean {
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":");
}

function isPrivateIp(host: string): boolean {
  const parts = host.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}
