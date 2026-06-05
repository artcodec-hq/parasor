import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppStateStore } from "../state/app-state.js";
import { createPtyHost, resolvePtyHostMode } from "./host.js";
import { parseVersionMismatch } from "./host-protocol/messages.js";

describe("createPtyHost factory", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "host-factory-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("in-process mode keeps the session domain writable", async () => {
    const store = new AppStateStore({ dir, debounceMs: 0 });
    store.setSessionsReadOnly(true); // ensure factory flips it back to false
    const host = await createPtyHost({ store, mode: "in-process" });
    expect(store.isSessionsReadOnly()).toBe(false);
    await host.disposeAll();
    store.destroy();
  });

  it("resolvePtyHostMode reads PARASOR_PTY_DAEMON env (default = remote)", () => {
    expect(
      resolvePtyHostMode({ PARASOR_PTY_DAEMON: "1" } as NodeJS.ProcessEnv),
    ).toBe("remote");
    expect(
      resolvePtyHostMode({ PARASOR_PTY_DAEMON: "0" } as NodeJS.ProcessEnv),
    ).toBe("in-process");
    expect(resolvePtyHostMode({} as NodeJS.ProcessEnv)).toBe("remote");
  });
});

/*
 * daemon protocol mismatch recovery -- parseVersionMismatch must keep recognizing the daemon's NACK
 * message verbatim because the version-mismatch recovery path uses it
 * to populate the banner detail. If the daemon-side wording drifts and
 * this regex stops matching, the banner falls back to "unknown" rather
 * than failing recovery; still, the parser is the only piece of the
 * recovery flow that is pure enough to unit-test directly.
 */
describe("parseVersionMismatch", () => {
  it("extracts both versions from the canonical NACK message", () => {
    expect(
      parseVersionMismatch("server 1.1.0 not compatible with daemon 1.0.0"),
    ).toEqual({ server: "1.1.0", daemon: "1.0.0" });
  });

  it("matches when the daemon NACK is wrapped with context (no trailing punctuation)", () => {
    // Mirrors host.ts where `connectErr.message` is the bare daemon NACK
    // (`server 2.3.4 not compatible with daemon 2.2.9`) without trailing
    // punctuation. The regex's `\S+` captures up to the next whitespace,
    // so trailing dots/commas would leak into the version string -- the
    // recovery path tolerates that by treating the parsed value as
    // banner detail only.
    expect(
      parseVersionMismatch(
        "parasor-pty-host: server 2.3.4 not compatible with daemon 2.2.9 (handshake aborted)",
      ),
    ).toEqual({ server: "2.3.4", daemon: "2.2.9" });
  });

  it("returns null when the message shape does not match", () => {
    expect(parseVersionMismatch("totally unrelated error")).toBeNull();
    expect(parseVersionMismatch("")).toBeNull();
  });
});
