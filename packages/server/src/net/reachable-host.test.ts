import { describe, expect, it } from "vitest";
import { resolveForwarderBindHost } from "./reachable-host.js";

describe("resolveForwarderBindHost", () => {
  it("returns null for loopback bind hosts", () => {
    expect(resolveForwarderBindHost("127.0.0.1")).toBeNull();
    expect(resolveForwarderBindHost("127.0.0.5")).toBeNull();
    expect(resolveForwarderBindHost("::1")).toBeNull();
    expect(resolveForwarderBindHost("localhost")).toBeNull();
  });

  it("returns a specific non-loopback bind host verbatim", () => {
    expect(resolveForwarderBindHost("192.168.1.20")).toBe("192.168.1.20");
    expect(resolveForwarderBindHost("100.101.102.103")).toBe("100.101.102.103");
  });

  it("returns 0.0.0.0 / :: verbatim (forwarder listens on an OS-assigned port)", () => {
    expect(resolveForwarderBindHost("0.0.0.0")).toBe("0.0.0.0");
    expect(resolveForwarderBindHost("::")).toBe("::");
  });
});
