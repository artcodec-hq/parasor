import { describe, expect, it } from "vitest";
import type { NetworkEndpoint } from "./endpoints.js";
import {
  buildAuthUrl,
  buildPairingUrl,
  buildQrSection,
  selectQrEndpoint,
} from "./qr.js";

const local: NetworkEndpoint = { category: "Local", address: "127.0.0.1" };
const lanEn0: NetworkEndpoint = {
  category: "LAN",
  address: "192.168.1.10",
  iface: "en0",
};
const lanBridge: NetworkEndpoint = {
  category: "LAN",
  address: "192.168.64.1",
  iface: "bridge100",
};
const tailscale: NetworkEndpoint = {
  category: "Tailscale",
  address: "100.64.0.2",
  iface: "utun4",
};

describe("selectQrEndpoint", () => {
  it("prefers Tailscale over LAN", () => {
    const pick = selectQrEndpoint([local, lanEn0, tailscale]);
    expect(pick).toBe(tailscale);
  });

  it("falls back to LAN when no Tailscale is present", () => {
    const pick = selectQrEndpoint([local, lanEn0]);
    expect(pick).toBe(lanEn0);
  });

  it("skips virtual bridge interfaces when picking LAN", () => {
    const pick = selectQrEndpoint([local, lanBridge, lanEn0]);
    expect(pick).toBe(lanEn0);
  });

  it("returns undefined when only loopback and virtual interfaces exist", () => {
    const pick = selectQrEndpoint([local, lanBridge]);
    expect(pick).toBeUndefined();
  });

  it("honors explicit iface override", () => {
    const pick = selectQrEndpoint([local, lanEn0, tailscale], "en0");
    expect(pick).toBe(lanEn0);
  });

  it("returns undefined when override iface is missing", () => {
    const pick = selectQrEndpoint([local, tailscale], "en99");
    expect(pick).toBeUndefined();
  });
});

describe("buildAuthUrl", () => {
  it("appends token query when auth mode is token", () => {
    expect(buildAuthUrl("100.64.0.2", 3000, "token", "abc")).toBe(
      "http://100.64.0.2:3000/?t=abc",
    );
  });

  it("omits token for trusted-network mode", () => {
    expect(buildAuthUrl("127.0.0.1", 3000, "none", "abc")).toBe(
      "http://127.0.0.1:3000",
    );
  });
});

describe("buildPairingUrl", () => {
  it("builds a replacement t query URL without exposing the auth token", () => {
    expect(buildPairingUrl("100.64.0.2", 3000, "pair-token")).toBe(
      "http://100.64.0.2:3000/?t=pair-token",
    );
  });

  it("rejects non-relative access paths", () => {
    for (const path of [
      "https://example.test/",
      "//example.test/",
      "/\\example",
      "/bad\r\nLocation: http://example.test/",
    ]) {
      expect(() =>
        buildPairingUrl("100.64.0.2", 3000, "pair-token", path),
      ).toThrow("access URL path must be same-origin relative");
    }
  });
});

describe("buildQrSection", () => {
  it("includes the scan hint line and QR rows for a valid endpoint", () => {
    const lines = buildQrSection({
      endpoints: [local, tailscale],
      port: 3000,
      authMode: "token",
      makeAccessUrl: (endpoint) =>
        buildPairingUrl(endpoint.address, 3000, "pair"),
    });
    expect(lines[0]).toBe("Scan to open on mobile -- Tailscale (utun4)");
    expect(lines[1]).toBe("  http://100.64.0.2:3000/?t=pair");
    expect(lines[2]).toBe("");
    expect(lines.length).toBeGreaterThan(6);
    // QR uses half-block characters; at least one row should contain the block glyph.
    expect(lines.some((row) => row.includes("█"))).toBe(true);
  });

  it("wraps the QR URL in OSC 8 when clickable is set", () => {
    const lines = buildQrSection({
      endpoints: [local, tailscale],
      port: 3000,
      authMode: "token",
      makeAccessUrl: (endpoint) =>
        buildPairingUrl(endpoint.address, 3000, "pair"),
      clickable: true,
    });
    const url = "http://100.64.0.2:3000/?t=pair";
    expect(lines[1]).toBe(`  \x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`);
  });

  it("reports a helpful message when no remote endpoint is available", () => {
    const lines = buildQrSection({
      endpoints: [local],
      port: 3000,
      authMode: "token",
      token: "abc",
    });
    expect(lines).toEqual([
      "QR: no remote endpoint detected. Run `tailscale up` or connect to a LAN.",
    ]);
  });

  it("reports missing iface when override does not match", () => {
    const lines = buildQrSection({
      endpoints: [local, lanEn0],
      port: 3000,
      authMode: "token",
      token: "abc",
      iface: "en99",
    });
    expect(lines[0]).toMatch(/^QR: interface "en99" not found/);
  });
});
