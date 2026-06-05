import { describe, expect, it } from "vitest";
import { isLocalMachineAddress, normalizeAddress } from "./local-machine.js";

describe("normalizeAddress", () => {
  it("normalizes IPv4-mapped IPv6 addresses", () => {
    expect(normalizeAddress("::ffff:192.168.1.42")).toBe("192.168.1.42");
    expect(normalizeAddress("::ffff:c0a8:012a")).toBe("192.168.1.42");
  });

  it("normalizes bracketed and scoped IPv6 addresses", () => {
    expect(normalizeAddress("[::1]")).toBe("::1");
    expect(normalizeAddress("fe80::1%lo0")).toBe("fe80::1");
  });
});

describe("isLocalMachineAddress", () => {
  it("accepts loopback remote addresses", () => {
    expect(isLocalMachineAddress("127.0.0.1")).toBe(true);
    expect(isLocalMachineAddress("127.0.0.9")).toBe(true);
    expect(isLocalMachineAddress("::1")).toBe(true);
    expect(isLocalMachineAddress("::ffff:127.0.0.1")).toBe(true);
  });

  it("accepts host interface remote addresses", () => {
    expect(
      isLocalMachineAddress("192.168.1.42", {
        interfaceAddresses: ["10.0.0.5", "192.168.1.42"],
      }),
    ).toBe(true);
    expect(
      isLocalMachineAddress("::ffff:192.168.1.42", {
        interfaceAddresses: ["192.168.1.42"],
      }),
    ).toBe(true);
  });

  it("rejects missing, invalid, and non-local remote addresses", () => {
    expect(isLocalMachineAddress(null)).toBe(false);
    expect(isLocalMachineAddress("not an address")).toBe(false);
    expect(
      isLocalMachineAddress("192.168.1.99", {
        interfaceAddresses: ["192.168.1.42"],
      }),
    ).toBe(false);
  });
});
