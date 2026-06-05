import { describe, expect, it } from "vitest";
import { buildStartupBanner } from "./startup-banner.js";

describe("buildStartupBanner", () => {
  it("renders token-auth URLs and auth file location", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "LAN", address: "192.168.1.2", iface: "en0" },
      ],
      port: 4010,
      tailscaleStatus: { state: "running" },
      token: "abc123",
    });

    expect(lines).toContain("parasor running on port 4010");
    expect(lines).toContain("  Local");
    expect(lines).toContain("    http://127.0.0.1:4010/?t=abc123");
    expect(lines).toContain("  LAN (en0)");
    expect(lines).toContain("    http://192.168.1.2:4010/?t=abc123");
    expect(lines).toContain("Auth: token (saved to /tmp/parasor/token)");
  });

  it("uses generated t query URLs without exposing the long-lived token", () => {
    let issued = 0;
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "LAN", address: "192.168.1.2", iface: "en0" },
      ],
      port: 4010,
      tailscaleStatus: { state: "running" },
      token: "long-lived-token",
      makeAccessUrl: (endpoint) =>
        `http://${endpoint.address}:4010/?t=pair-${++issued}`,
    });

    const joined = lines.join("\n");
    expect(joined).toContain("http://127.0.0.1:4010/?t=pair-1");
    expect(joined).toContain("http://192.168.1.2:4010/?t=pair-2");
    expect(joined).not.toContain("long-lived-token");
  });

  it("renders trusted-network auth and tailscale guidance", () => {
    const lines = buildStartupBanner({
      authMode: "none",
      configDir: "/tmp/parasor",
      endpoints: [{ category: "Local", address: "127.0.0.1" }],
      port: 3000,
      tailscaleStatus: { state: "stopped" },
      token: "ignored",
    });

    expect(lines).toContain("  Local");
    expect(lines).toContain("    http://127.0.0.1:3000");
    expect(lines).toContain("Auth: none (trusted network mode)");
    expect(lines).toContain(
      "  Tailscale is installed but not running. Run `tailscale up` for remote access.",
    );
  });

  it("renders a Tailscale MagicDNS URL when provided as an endpoint", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "Tailscale", address: "100.64.0.2", iface: "utun4" },
        {
          category: "Tailscale",
          address: "host.tail.ts.net",
          iface: "MagicDNS",
        },
      ],
      port: 4010,
      tailscaleStatus: { state: "running", magicDNS: "host.tail.ts.net" },
      token: "abc",
    });

    expect(lines).toContain("  Tailscale (utun4)");
    expect(lines).toContain("    http://100.64.0.2:4010/?t=abc");
    expect(lines).toContain("  Tailscale (MagicDNS)");
    expect(lines).toContain("    http://host.tail.ts.net:4010/?t=abc");
  });

  it("embeds a QR section when qr.enabled and a remote endpoint exists", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "Tailscale", address: "100.64.0.2", iface: "utun4" },
      ],
      port: 3000,
      tailscaleStatus: { state: "running" },
      makeAccessUrl: (endpoint) => `http://${endpoint.address}:3000/?t=qr-pair`,
      qr: { enabled: true },
    });

    expect(
      lines.some((line) =>
        line.startsWith("Scan to open on mobile -- Tailscale (utun4)"),
      ),
    ).toBe(true);
    expect(lines.some((line) => line.includes("█"))).toBe(true);
    expect(lines.join("\n")).toContain("http://100.64.0.2:3000/?t=qr-pair");
  });

  it("omits the QR section when qr.enabled is false", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Tailscale", address: "100.64.0.2", iface: "utun4" },
      ],
      port: 3000,
      tailscaleStatus: { state: "running" },
      token: "abc",
      qr: { enabled: false },
    });

    expect(lines.every((line) => !line.includes("█"))).toBe(true);
    expect(
      lines.every((line) => !line.startsWith("Scan to open on mobile")),
    ).toBe(true);
  });

  it("shows the loopback-restriction tip on the default 0.0.0.0 bind", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "LAN", address: "192.168.1.5", iface: "en0" },
      ],
      port: 7681,
      tailscaleStatus: { state: "stopped" },
      token: "abc",
      bind: { explicit: false, host: "0.0.0.0" },
    });

    const joined = lines.join("\n");
    expect(joined).toContain("parasor --host 127.0.0.1");
  });

  it("hides the tip when the user explicitly chose a bind", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [{ category: "Local", address: "127.0.0.1" }],
      port: 7681,
      tailscaleStatus: { state: "stopped" },
      token: "abc",
      bind: { explicit: true, host: "127.0.0.1" },
    });

    expect(lines.join("\n")).not.toContain("parasor --host 127.0.0.1");
  });

  it("hides unreachable endpoints when single-binding to a Tailscale IP", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "LAN", address: "192.168.1.5", iface: "en0" },
        { category: "Tailscale", address: "100.64.0.2", iface: "utun4" },
        {
          category: "Tailscale",
          address: "host.tail.ts.net",
          iface: "MagicDNS",
        },
      ],
      port: 7681,
      tailscaleStatus: { state: "running", magicDNS: "host.tail.ts.net" },
      token: "abc",
      bind: { explicit: true, host: "100.64.0.2" },
    });

    const joined = lines.join("\n");
    expect(joined).not.toContain("127.0.0.1");
    expect(joined).not.toContain("192.168.1.5");
    expect(joined).toContain("100.64.0.2");
    expect(joined).toContain("host.tail.ts.net");
  });

  it("hides loopback URL when single-binding to a LAN IP", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "LAN", address: "192.168.1.5", iface: "en0" },
        { category: "LAN", address: "192.168.1.10", iface: "en1" },
      ],
      port: 7681,
      tailscaleStatus: { state: "stopped" },
      token: "abc",
      bind: { explicit: true, host: "192.168.1.5" },
    });

    const joined = lines.join("\n");
    expect(joined).not.toContain("127.0.0.1");
    expect(joined).not.toContain("192.168.1.10");
    expect(joined).toContain("192.168.1.5");
  });

  it("emits plain URLs when clickable is false (default)", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [{ category: "Local", address: "127.0.0.1" }],
      port: 7681,
      tailscaleStatus: { state: "stopped" },
      token: "abc",
    });

    const joined = lines.join("\n");
    expect(joined).not.toContain("\x1b]8;;");
    expect(joined).toContain("    http://127.0.0.1:7681/?t=abc");
  });

  it("wraps URLs in OSC 8 hyperlinks when clickable is true", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [{ category: "Local", address: "127.0.0.1" }],
      port: 7681,
      tailscaleStatus: { state: "stopped" },
      token: "abc",
      clickable: true,
    });

    const url = "http://127.0.0.1:7681/?t=abc";
    expect(lines).toContain(`    \x1b]8;;${url}\x1b\\${url}\x1b]8;;\x1b\\`);
  });

  it("falls back to plain URL if a control character would break OSC 8", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Tailscale", address: "evil\x1b.host", iface: "MagicDNS" },
      ],
      port: 7681,
      tailscaleStatus: { state: "running", magicDNS: "evil\x1b.host" },
      token: "abc",
      clickable: true,
    });

    const joined = lines.join("\n");
    expect(joined).not.toContain("\x1b]8;;");
    expect(joined).toContain("http://evil\x1b.host:7681/?t=abc");
  });

  it("shows all endpoints when binding to 0.0.0.0", () => {
    const lines = buildStartupBanner({
      authMode: "token",
      configDir: "/tmp/parasor",
      endpoints: [
        { category: "Local", address: "127.0.0.1" },
        { category: "LAN", address: "192.168.1.5", iface: "en0" },
      ],
      port: 7681,
      tailscaleStatus: { state: "stopped" },
      token: "abc",
      bind: { explicit: false, host: "0.0.0.0" },
    });

    const joined = lines.join("\n");
    expect(joined).toContain("127.0.0.1");
    expect(joined).toContain("192.168.1.5");
  });
});
