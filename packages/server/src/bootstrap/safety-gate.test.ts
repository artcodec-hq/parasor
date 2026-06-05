import { describe, expect, it, vi } from "vitest";
import {
  enforceSafetyGate,
  isLoopback,
  selectBindAddress,
} from "./safety-gate.js";

describe("isLoopback", () => {
  it("accepts 127.0.0.0/8 addresses", () => {
    expect(isLoopback("127.0.0.1")).toBe(true);
    expect(isLoopback("127.0.0.53")).toBe(true);
    expect(isLoopback("127.255.255.255")).toBe(true);
  });

  it("accepts IPv6 loopback ::1", () => {
    expect(isLoopback("::1")).toBe(true);
  });

  it("accepts the literal 'localhost'", () => {
    expect(isLoopback("localhost")).toBe(true);
  });

  it("rejects 0.0.0.0 (all interfaces)", () => {
    expect(isLoopback("0.0.0.0")).toBe(false);
  });

  it("rejects LAN / Tailscale addresses", () => {
    expect(isLoopback("192.168.1.10")).toBe(false);
    expect(isLoopback("100.64.0.2")).toBe(false);
    expect(isLoopback("10.0.0.5")).toBe(false);
  });

  it("rejects IPv6 ::", () => {
    expect(isLoopback("::")).toBe(false);
  });
});

describe("selectBindAddress", () => {
  it("defaults to 0.0.0.0 (all interfaces)", () => {
    expect(selectBindAddress({ explicit: undefined })).toBe("0.0.0.0");
  });

  it("treats empty-string explicit as no input and falls back to default", () => {
    expect(selectBindAddress({ explicit: "" })).toBe("0.0.0.0");
  });

  it("honors an explicit loopback override", () => {
    expect(selectBindAddress({ explicit: "127.0.0.1" })).toBe("127.0.0.1");
  });

  it("honors an explicit LAN IP", () => {
    expect(selectBindAddress({ explicit: "192.168.1.10" })).toBe(
      "192.168.1.10",
    );
  });

  it("honors an explicit Tailscale IP", () => {
    expect(selectBindAddress({ explicit: "100.64.0.2" })).toBe("100.64.0.2");
  });
});

describe("enforceSafetyGate", () => {
  function fakeExit(): { exit: (code?: number) => never; calls: number[] } {
    const calls: number[] = [];
    const exit = ((code?: number) => {
      calls.push(code ?? 0);
      throw new Error(`__exit:${code ?? 0}`);
    }) as (code?: number) => never;
    return { exit, calls };
  }

  it("allows AUTH=none with a loopback bind", () => {
    const { exit, calls } = fakeExit();
    enforceSafetyGate({
      authMode: "none",
      bindHost: "127.0.0.1",
      allowUnsafe: false,
      exit,
      error: () => {},
    });
    expect(calls).toEqual([]);
  });

  it("refuses AUTH=none with a non-loopback bind (Tailscale included)", () => {
    const { exit, calls } = fakeExit();
    const err = vi.fn();
    expect(() =>
      enforceSafetyGate({
        authMode: "none",
        bindHost: "100.64.0.2",
        allowUnsafe: false,
        exit,
        error: err,
      }),
    ).toThrow("__exit:1");
    expect(calls).toEqual([1]);
    expect(err).toHaveBeenCalled();
  });

  it("refuses AUTH=none with explicit 0.0.0.0", () => {
    const { exit, calls } = fakeExit();
    expect(() =>
      enforceSafetyGate({
        authMode: "none",
        bindHost: "0.0.0.0",
        allowUnsafe: false,
        exit,
        error: () => {},
      }),
    ).toThrow("__exit:1");
    expect(calls).toEqual([1]);
  });

  it("bypasses the refusal when PARASOR_ALLOW_UNSAFE is set", () => {
    const { exit, calls } = fakeExit();
    enforceSafetyGate({
      authMode: "none",
      bindHost: "0.0.0.0",
      allowUnsafe: true,
      exit,
      error: () => {},
    });
    expect(calls).toEqual([]);
  });

  it("allows AUTH=token and AUTH=allowlist on non-loopback without restriction", () => {
    const { exit, calls } = fakeExit();
    enforceSafetyGate({
      authMode: "token",
      bindHost: "0.0.0.0",
      allowUnsafe: false,
      exit,
      error: () => {},
    });
    enforceSafetyGate({
      authMode: "allowlist",
      bindHost: "100.64.0.2",
      allowUnsafe: false,
      exit,
      error: () => {},
    });
    expect(calls).toEqual([]);
  });
});
