import type { AgentDetector } from "../../agent-detector/detector.js";
import { isKnownAgent, mapEventType } from "../../agent-detector/event-map.js";
import type { AgentStatusRecorder } from "../../debug/agent-status-recorder.js";
import type { PtyHost } from "../../pty/host.js";
import {
  HookAccessError,
  HookNotFoundError,
  HookRateLimitError,
  HookValidationError,
} from "./errors.js";
import { nativeStatusIntegrationForHookAgent } from "./native-status-integrations.js";

const LITERAL_LOOPBACK_HOSTS = new Set([
  "127.0.0.1",
  "::1",
  "::ffff:127.0.0.1",
]);
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 1000;
const RATE_LIMIT_BUCKET_CAP = 4096;

interface RateBucket {
  count: number;
  windowStart: number;
}

export interface HookRequestBody {
  sessionId?: unknown;
  agent?: unknown;
  event?: unknown;
}

interface CreateHookNotifierOptions {
  agentDetector: AgentDetector;
  now?: () => number;
  ptyManager: PtyHost;
  debugRecorder?: AgentStatusRecorder;
}

export function isLoopbackAddress(address: string | null): boolean {
  if (!address) return false;
  if (LITERAL_LOOPBACK_HOSTS.has(address)) return true;
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(address)) return true;
  if (/^::ffff:127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/i.test(address)) return true;

  const hexMatch = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hexMatch) {
    const high = parseInt(hexMatch[1], 16);
    return high >>> 8 === 0x7f;
  }

  return false;
}

export function createHookNotifier({
  agentDetector,
  now = () => Date.now(),
  ptyManager,
  debugRecorder,
}: CreateHookNotifierOptions) {
  const buckets = new Map<string, RateBucket>();

  return {
    notify(remoteAddress: string | null, body: HookRequestBody | null) {
      if (!isLoopbackAddress(remoteAddress)) {
        throw new HookAccessError();
      }
      const remoteIp = remoteAddress;

      if (!remoteIp || !checkRateLimit(buckets, remoteIp, now())) {
        throw new HookRateLimitError();
      }

      if (!body) {
        throw new HookValidationError("invalid json");
      }

      const { agent, event, sessionId } = body;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new HookValidationError("sessionId required");
      }
      if (
        typeof agent !== "string" ||
        !isKnownAgent(agent) ||
        !nativeStatusIntegrationForHookAgent(agent)
      ) {
        throw new HookValidationError("unknown agent");
      }
      if (typeof event !== "string" || event.length === 0) {
        throw new HookValidationError("event required");
      }

      if (!ptyManager.get(sessionId)) {
        throw new HookNotFoundError();
      }

      debugRecorder?.record(
        "hook-received",
        {
          agent,
          event,
          remoteAddress: remoteAddress ?? "",
        },
        sessionId,
      );

      const result = mapEventType(agent, event);

      if (process.env.PARASOR_HOOK_DEBUG === "1") {
        const resolved =
          result.kind === "state"
            ? `-> ${result.state.lifecycle}`
            : result.kind === "noop"
              ? "-> noop"
              : "-> unknown";
        // eslint-disable-next-line no-console
        console.error(
          `[hook] session=${sessionId.slice(0, 8)} agent=${agent} event=${event} ${resolved}`,
        );
      }

      if (result.kind === "unknown") {
        throw new HookValidationError(`unknown event for ${agent}: ${event}`);
      }
      if (result.kind === "noop") {
        debugRecorder?.record(
          "hook-mapped",
          {
            agent,
            event,
            result: "noop",
          },
          sessionId,
        );
        return { ok: true as const, applied: false as const };
      }

      debugRecorder?.record(
        "hook-mapped",
        {
          agent,
          event,
          result: "state",
          lifecycle: result.state.lifecycle,
          source: result.state.source,
          confidence: result.state.confidence,
        },
        sessionId,
      );
      agentDetector.setExternalState(sessionId, result.state);
      return {
        ok: true as const,
        applied: true as const,
        lifecycle: result.state.lifecycle,
        source: result.state.source,
        confidence: result.state.confidence,
      };
    },
  };
}

function checkRateLimit(
  buckets: Map<string, RateBucket>,
  ip: string,
  now: number,
): boolean {
  const bucket = buckets.get(ip);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    if (buckets.size >= RATE_LIMIT_BUCKET_CAP && !buckets.has(ip)) {
      pruneExpired(buckets, now);
    }
    buckets.set(ip, { count: 1, windowStart: now });
    return true;
  }

  bucket.count++;
  return bucket.count <= RATE_LIMIT_MAX;
}

function pruneExpired(buckets: Map<string, RateBucket>, now: number): void {
  for (const [ip, bucket] of buckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
      buckets.delete(ip);
    }
  }
}
