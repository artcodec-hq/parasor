import { describe, expect, it } from "vitest";
import { PairingTokenStore } from "./pairing-token.js";

describe("PairingTokenStore", () => {
  it("issues random-looking memory-only tokens", () => {
    const store = new PairingTokenStore();
    const a = store.issue();
    const b = store.issue();

    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(b.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.token).not.toBe(b.token);
  });

  it("consumes a token once", () => {
    const store = new PairingTokenStore();
    const issued = store.issue();

    expect(store.consume(issued.token)).toEqual({
      ok: true,
      expiresAt: issued.expiresAt,
    });
    expect(store.consume(issued.token)).toEqual({
      ok: false,
      reason: "used",
    });
  });

  it("rejects expired tokens and removes them lazily", () => {
    let now = 1000;
    const store = new PairingTokenStore({ now: () => now, defaultTtlMs: 10 });
    const issued = store.issue();

    now = 1010;

    expect(store.consume(issued.token)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(store.consume(issued.token)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("rejects missing tokens", () => {
    const store = new PairingTokenStore();

    expect(store.consume(undefined)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(store.consume("not-issued")).toEqual({
      ok: false,
      reason: "missing",
    });
  });
});
