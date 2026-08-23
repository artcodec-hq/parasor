/*
 * Typed payload schemas for PtyHost IPC frames.
 *
 * Frame envelope (length, type, connectionId, generation, requestId) lives
 * in `frames.ts`. This module defines the JSON payloads carried inside
 * each frame type plus the  version-compat rule. Stream-payload frames
 * (WRITE / DATA / SESSION_INPUT) bypass JSON entirely -- see
 * `STREAM_FRAME_TYPES` and `encodeStreamPayload` in `frames.ts`.
 */

import { Buffer } from "node:buffer";
import type {
  IdeCommandConfig,
  PaneCommandConfig,
  Project,
  ProjectState,
  ServiceConfig,
  Session,
  SessionCommand,
  SessionEndReason,
  SessionLaunchPreset,
  WorkItem,
} from "@parasor/shared";

/*
 * 2.6.0 -- adds `workItems` to PERSIST_PROJECT_DOMAINS_REQ so project-scoped
 * work items persist through the daemon single-writer path. A 2.5.x daemon
 * would ACK but silently ignore that field, so the minor bump forces a daemon
 * restart before the server relies on work item persistence.
 *
 * 2.5.0 -- adds optional `launchPreset` to CREATE_REQ so shell-preset
 * sessions keep their launch/runtime metadata across the daemon boundary.
 * A 2.4.x daemon would ACK but silently ignore that field, so the minor bump
 * forces a daemon restart before the server relies on preset identity.
 *
 * 2.4.0 -- adds `ideCommands` to PERSIST_PROJECT_DOMAINS_REQ so custom
 * IDE launchers persist through the daemon single-writer path. A 2.3.x
 * daemon would ACK but silently ignore that field, so the minor bump forces
 * a daemon restart before the server relies on it.
 *
 * 2.3.0 -- adds `paneCommands` to PERSIST_PROJECT_DOMAINS_REQ so server-side
 * terminal launcher commands persist through the daemon single-writer path.
 * A 2.2.x daemon would ACK but silently ignore that field, so the minor bump
 * forces a daemon restart before the server relies on it.
 *
 * 2.2.0 -- adds PAUSE_OUTPUT / RESUME_OUTPUT fire-and-forget frames so
 * terminal WebSocket backpressure can reach daemon-owned PTYs. The minor
 * bump forces older 2.1 daemons to restart before a new server relies on
 * the new frame types.
 *
 * 2.1.0 -- added optional `bootstrapInput` to CREATE_REQ so the daemon can
 * feed one-shot startup input into a newly-spawned PTY. A 2.0.x daemon would
 * ignore that field and create an empty shell, so the MINOR bump forces the
 * upgraded server to restart the daemon before command-launcher sessions run.
 *
 * 2.0.0 -- MAJOR bump for PTY generation gate. Both WRITE (server->daemon, INPUT) and
 * DATA (daemon->server, OUTPUT) frames now carry a uint32 BE generation
 * field between sessionId and data: `[idLen][sessionId][gen:u32 BE][data]`.
 * This is wire-incompatible with 1.x -- a 1.x daemon that received a 2.0
 * WRITE frame would mis-parse the 4-byte gen as the leading bytes of
 * `data` and corrupt the new shell's stdin; a 1.x server that received
 * a 2.0 DATA frame would mis-parse it the same way. The `daemon.minor ≥
 * client.minor` compat rule does NOT cover the inverse direction (older
 * server vs newer daemon), so we MUST bump MAJOR -- `c.major !== d.major`
 * cleanly rejects every 1.x ↔ 2.x pairing at handshake and forces the
 * server to cold-restart the daemon before any WRITE/DATA flows. The
 * MAJOR bump also subsumes the 1.3.0 force-restart goal -- any 1.x
 * daemon (including 1.3.x) is rejected at handshake, so per-session
 * uploadsDir injection from upload staging isolation is also picked up by the cold-restart.
 *
 * 1.3.0 -- upload staging isolation . Daemon-side `InProcessPtyHost`
 * now consumes `uploadsDir` and stamps `PARASOR_UPLOAD_DIR=<dir>/<sid>`
 * onto every spawned PTY's env via `buildSessionEnv`. A stale 1.2.x
 * daemon would still hold the before upload staging isolation global `PARASOR_UPLOAD_DIR=<root>`
 * (set by the old `setPtyEnv` path in the upgraded server's predecessor)
 * -- the cross-session leak we fixed. Bumping the version forces the
 *  handshake to NACK `version-mismatch`, which `host.ts` already
 * routes through `terminateDaemon` + `spawnDaemon` so the replacement
 * daemon picks up the new per-session injection. No payload schema
 * changed; the bump is purely a forced-restart signal.
 *
 * 1.2.0 -- added `attachToken` to InitClientReq (server-minted, echoed
 * on the matching ACK) and DetachClient payloads for attach fencing fencing-token
 * detach. A pre-1.2.0 daemon ignores the field and treats DETACH_CLIENT
 * as unconditional delete, which would re-open the same-clientId race
 * during a daemon-running-across-upgrade window.
 *  compat rule (daemon.minor ≥ client.minor) rejects 1.1.x daemons
 * at handshake so the upgraded server cold-restarts the daemon before
 * any WS attaches.
 *
 * 1.1.0 -- added PERSIST_PROJECT_DOMAINS_REQ/ACK (frame types 0x1c/0x1d)
 * for daemon state ownership single-writer-of-state.json.
 *
 * 1.0.0 -- initial release.
 */
export const PROTOCOL_VERSION = "2.6.0";

export interface HelloPayload {
  protocolVersion: string;
  serverPid: number;
}

export interface HelloAckPayload {
  protocolVersion: string;
  connectionId: number;
  /** stringified bigint (JSON cannot carry u64 directly). */
  generation: string;
  daemonPid: number;
  daemonStartedAt: string;
}

export type NackCode =
  // handshake-time codes (no requestId)
  | "version-mismatch"
  | "evicted"
  | "daemon-shutting-down"
  | "frame-too-large"
  | "frame-invalid"
  | "unknown-frame-type"
  | "handshake-required"
  // request-time codes (requestId set, NACK substitutes for the matching ACK)
  | "session-not-found"
  | "create-failed"
  | "restart-failed"
  | "persist-failed"
  | "internal-error";

export interface NackPayload {
  code: NackCode;
  message: string;
}

// --- request -> ack pairs (Promise<X>-returning PtyHost methods) ---

export interface CreateReqPayload {
  projectId: string;
  command: SessionCommand;
  cwd: string;
  title?: string;
  launchPreset?: SessionLaunchPreset;
  bootstrapInput?: string;
}
export interface CreateAckPayload {
  session: Session;
}

export interface RestartReqPayload {
  sessionId: string;
}
export interface RestartAckPayload {
  session: Session;
}

export interface DisposeReqPayload {
  sessionId: string;
}
// DISPOSE_ACK / DISPOSE_ALL_ACK / SHUTDOWN_ALL_ACK carry empty payload {}.
export type EmptyAckPayload = Record<string, never>;

export interface InitClientReqPayload {
  sessionId: string;
  clientId: string;
  cols: number;
  rows: number;
  /**
   * Attach fencing: server-side monotonic counter identifying this attach.
   * Daemon stamps it onto its `attachedClients` entry so a stale
   * DETACH_CLIENT (delivered after the new attach already overwrote the
   * map slot) can be filtered against the current entry's stamp.
   * Optional for older clients/peers that predate the fence.
   */
  attachToken?: number;
}
export interface InitClientAckPayload {
  /** false when sessionId is unknown or daemon refuses (e.g. evicted). */
  accepted: boolean;
  /** Optional for compatibility with daemon peers predating geometry sync. */
  geometry?: { cols: number; rows: number; epoch: number };
}

/*
 * daemon state ownership -- server forwards project-domain snapshot to daemon for
 * persistence so the daemon stays the sole writer of state.json.
 * Server-side mutate{Projects,ProjectStates,ServiceConfig,PaneCommands} schedule a
 * flush that, in remote mode, sends this REQ instead of writing the
 * file. Daemon adopts the server-owned domains via internalMutate and routes
 * through its existing flush. ACK gates on persistence success so the
 * caller can surface IO errors back through the API.
 */
export interface PersistProjectDomainsReqPayload {
  projects: Project[];
  projectStates: Record<string, ProjectState>;
  workItems: Record<string, WorkItem[]>;
  serviceConfig: ServiceConfig;
  paneCommands?: PaneCommandConfig[];
  ideCommands?: IdeCommandConfig[];
}

// --- fire-and-forget mutators (sync-returning PtyHost methods) ---

// WRITE uses stream payload (binary, see frames.ts encodeStreamPayload).

export interface ResizePayload {
  sessionId: string;
  cols: number;
  rows: number;
}

export interface GeometryPayload {
  sessionId: string;
  cols: number;
  rows: number;
  epoch: number;
}

export interface RefreshPayload {
  sessionId: string;
}

export interface FlowControlPayload {
  sessionId: string;
  clientId: string;
}

export interface DetachClientPayload {
  sessionId: string;
  clientId: string;
  /**
   * Attach fencing: when present, the daemon only deletes the entry whose
   * stored attach-token matches. A stale onClose racing a new attach
   * carries the old token; the daemon's current entry already holds the
   * new token, so the delete is skipped and the live listener survives.
   */
  attachToken?: number;
}

export interface SetTitlePayload {
  sessionId: string;
  title: string;
  titleManual?: boolean;
}

export interface SetPinnedPayload {
  sessionId: string;
  pinned: boolean;
}

export interface SetPtyEnvPayload {
  env: Record<string, string>;
}

// --- daemon -> server events (no requestId; broadcast-style) ---

// DATA uses stream payload (binary, see frames.ts encodeStreamPayload).
// SESSION_INPUT uses stream payload too -- same shape as WRITE but flowing
// the reverse direction so server hooks can observe input the daemon
// committed.

export interface SessionUpdatePayload {
  session: Session;
}

export interface SessionListPayload {
  sessions: Session[];
}

export interface SessionExitPayload {
  sessionId: string;
  /** Session.generation at the time the PTY exited (restart counter). */
  sessionGeneration: number;
  endReason: SessionEndReason;
}

export function encodeJsonPayload(value: unknown): Buffer {
  return Buffer.from(JSON.stringify(value), "utf8");
}

export function decodeJsonPayload<T>(payload: Buffer): T {
  return JSON.parse(payload.toString("utf8")) as T;
}

interface Semver {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemver(input: string): Semver | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(input);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
  };
}

/**
 *  compat rule: MAJOR must match AND daemon.MINOR ≥ client.MINOR.
 * Client = the side that initiates HELLO (server). Daemon side runs this
 * on receiving HELLO; server side runs it after reading HELLO_ACK to
 * detect the "daemon older than server" case.
 */
export function isCompatibleVersion(
  clientVersion: string,
  daemonVersion: string,
): boolean {
  const c = parseSemver(clientVersion);
  const d = parseSemver(daemonVersion);
  if (!c || !d) return false;
  if (c.major !== d.major) return false;
  return d.minor >= c.minor;
}

/**
 * daemon protocol mismatch recovery -- extract `(server, daemon)` versions from the daemon-side NACK
 * message format `server X.Y.Z not compatible with daemon X.Y.Z`. The
 * daemon emits this verbatim (host-daemon/daemon.ts:272). Returns null
 * when the message shape changes -- recovery and probe paths fall back to
 * `daemonProtocolVersion: "unknown"` in that case.
 */
export function parseVersionMismatch(
  msg: string,
): { server: string; daemon: string } | null {
  const m = msg.match(/server (\S+) not compatible with daemon (\S+)/);
  if (!m) return null;
  return { server: m[1], daemon: m[2] };
}
