import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import {
  classifyInterfaces,
  type NetworkEndpoint,
  withMagicDNS,
} from "./endpoints.js";

describe("classifyInterfaces", () => {
  it("always includes localhost", () => {
    const result = classifyInterfaces({});
    expect(result).toContainEqual({ category: "Local", address: "127.0.0.1" });
  });

  it("classifies RFC1918 10.x as LAN", () => {
    const ifaces: Record<string, NetworkInterfaceInfo[]> = {
      en0: [
        {
          address: "10.0.1.42",
          family: "IPv4",
          netmask: "255.255.255.0",
          internal: false,
          cidr: "10.0.1.42/24",
          mac: "00:00:00:00:00:00",
        },
      ],
    };
    const result = classifyInterfaces(ifaces);
    expect(result).toContainEqual({
      category: "LAN",
      address: "10.0.1.42",
      iface: "en0",
    });
  });

  it("classifies 192.168.x as LAN", () => {
    const ifaces: Record<string, NetworkInterfaceInfo[]> = {
      en0: [
        {
          address: "192.168.1.100",
          family: "IPv4",
          netmask: "255.255.255.0",
          internal: false,
          cidr: "192.168.1.100/24",
          mac: "00:00:00:00:00:00",
        },
      ],
    };
    const result = classifyInterfaces(ifaces);
    expect(result).toContainEqual({
      category: "LAN",
      address: "192.168.1.100",
      iface: "en0",
    });
  });

  it("classifies 172.16-31.x as LAN", () => {
    const ifaces: Record<string, NetworkInterfaceInfo[]> = {
      en0: [
        {
          address: "172.20.0.5",
          family: "IPv4",
          netmask: "255.240.0.0",
          internal: false,
          cidr: "172.20.0.5/12",
          mac: "00:00:00:00:00:00",
        },
      ],
    };
    const result = classifyInterfaces(ifaces);
    expect(result).toContainEqual({
      category: "LAN",
      address: "172.20.0.5",
      iface: "en0",
    });
  });

  it("classifies CGNAT 100.64.x as Tailscale", () => {
    const ifaces: Record<string, NetworkInterfaceInfo[]> = {
      utun3: [
        {
          address: "100.64.12.34",
          family: "IPv4",
          netmask: "255.192.0.0",
          internal: false,
          cidr: "100.64.12.34/10",
          mac: "00:00:00:00:00:00",
        },
      ],
    };
    const result = classifyInterfaces(ifaces);
    expect(result).toContainEqual({
      category: "Tailscale",
      address: "100.64.12.34",
      iface: "utun3",
    });
  });

  it("classifies tailscale0 interface as Tailscale", () => {
    const ifaces: Record<string, NetworkInterfaceInfo[]> = {
      tailscale0: [
        {
          address: "100.100.1.1",
          family: "IPv4",
          netmask: "255.0.0.0",
          internal: false,
          cidr: "100.100.1.1/8",
          mac: "00:00:00:00:00:00",
        },
      ],
    };
    const result = classifyInterfaces(ifaces);
    expect(result).toContainEqual({
      category: "Tailscale",
      address: "100.100.1.1",
      iface: "tailscale0",
    });
  });

  it("classifies VPN interfaces", () => {
    const ifaces: Record<string, NetworkInterfaceInfo[]> = {
      utun5: [
        {
          address: "10.200.1.5",
          family: "IPv4",
          netmask: "255.255.255.0",
          internal: false,
          cidr: "10.200.1.5/24",
          mac: "00:00:00:00:00:00",
        },
      ],
    };
    // utun with non-CGNAT address -> VPN
    const result = classifyInterfaces(ifaces);
    const vpn = result.find((e) => e.category === "VPN");
    expect(vpn).toMatchObject({
      category: "VPN",
      address: "10.200.1.5",
      iface: "utun5",
    });
  });

  it("withMagicDNS inserts MagicDNS entry right after the first Tailscale IP", () => {
    const endpoints: NetworkEndpoint[] = [
      { category: "Local", address: "127.0.0.1" },
      { category: "Tailscale", address: "100.64.1.2", iface: "utun3" },
      { category: "LAN", address: "192.168.1.10", iface: "en0" },
    ];
    const result = withMagicDNS(endpoints, "host.tail.ts.net");
    expect(result).toEqual([
      { category: "Local", address: "127.0.0.1" },
      { category: "Tailscale", address: "100.64.1.2", iface: "utun3" },
      {
        category: "Tailscale",
        address: "host.tail.ts.net",
        iface: "MagicDNS",
      },
      { category: "LAN", address: "192.168.1.10", iface: "en0" },
    ]);
  });

  it("withMagicDNS appends MagicDNS when no Tailscale IP exists", () => {
    const endpoints: NetworkEndpoint[] = [
      { category: "Local", address: "127.0.0.1" },
    ];
    const result = withMagicDNS(endpoints, "host.tail.ts.net");
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({
      category: "Tailscale",
      address: "host.tail.ts.net",
      iface: "MagicDNS",
    });
  });

  it("withMagicDNS returns input unchanged when magicDNS is undefined", () => {
    const endpoints: NetworkEndpoint[] = [
      { category: "Local", address: "127.0.0.1" },
      { category: "Tailscale", address: "100.64.1.2", iface: "utun3" },
    ];
    expect(withMagicDNS(endpoints, undefined)).toBe(endpoints);
  });

  it("skips IPv6 and internal interfaces", () => {
    const ifaces: Record<string, NetworkInterfaceInfo[]> = {
      lo0: [
        {
          address: "127.0.0.1",
          family: "IPv4",
          netmask: "255.0.0.0",
          internal: true,
          cidr: "127.0.0.1/8",
          mac: "00:00:00:00:00:00",
        },
      ],
      en0: [
        {
          address: "fe80::1",
          family: "IPv6",
          netmask: "ffff:ffff:ffff:ffff::",
          internal: false,
          cidr: "fe80::1/64",
          mac: "00:00:00:00:00:00",
          scopeid: 1,
        },
      ],
    };
    const result = classifyInterfaces(ifaces);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("Local");
  });
});
