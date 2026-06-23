import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type TerminalPresenceEffect,
  TerminalPresenceManager,
} from "./terminal-presence-manager.js";

describe("TerminalPresenceManager", () => {
  let now: number;
  let effects: TerminalPresenceEffect[];
  let manager: TerminalPresenceManager;

  beforeEach(() => {
    vi.useFakeTimers();
    now = 1_000;
    effects = [];
    manager = new TerminalPresenceManager({
      now: () => now,
      onEffects: (next) => effects.push(...next),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function advance(ms: number): void {
    now += ms;
    vi.advanceTimersByTime(ms);
  }

  function resizeEffects(updateEffects: TerminalPresenceEffect[]) {
    return updateEffects.filter((effect) => effect.type === "resize");
  }

  it("starts idle for an unknown session", () => {
    expect(manager.get("s1")).toEqual({
      sessionId: "s1",
      driver: { kind: "idle" },
      layout: null,
      subscribers: [],
    });
  });

  it("mobile subscribe in auto mode takes the floor", () => {
    const update = manager.subscribeMobile(
      "s1",
      "phone-a",
      { cols: 45, rows: 20 },
      "auto",
    );

    expect(update.snapshot.driver).toEqual({
      kind: "mobile",
      clientId: "phone-a",
    });
    expect(update.snapshot.layout).toEqual({
      kind: "mobile",
      ownerClientId: "phone-a",
      cols: 45,
      rows: 20,
    });
    expect(resizeEffects(update.effects)).toEqual([
      { type: "resize", sessionId: "s1", cols: 45, rows: 20 },
    ]);
  });

  it("mobile subscribe in desktop mode is passive", () => {
    manager.recordDesktopGeometry("s1", { cols: 150, rows: 40 });

    const update = manager.subscribeMobile(
      "s1",
      "phone-a",
      { cols: 45, rows: 20 },
      "desktop",
    );

    expect(update.snapshot.driver).toEqual({ kind: "idle" });
    expect(update.snapshot.layout).toEqual({
      kind: "desktop",
      cols: 150,
      rows: 40,
    });
    expect(resizeEffects(update.effects)).toEqual([]);
  });

  it("desktop reclaim holds desktop driver until mobile acts", () => {
    manager.recordDesktopGeometry("s1", { cols: 150, rows: 40 });
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });
    const reclaim = manager.reclaimForDesktop("s1");

    expect(reclaim.snapshot.driver).toEqual({ kind: "desktop" });
    expect(reclaim.snapshot.layout).toEqual({
      kind: "desktop",
      cols: 150,
      rows: 40,
    });

    advance(10);
    const passive = manager.subscribeMobile("s1", "phone-b", {
      cols: 38,
      rows: 18,
    });
    expect(passive.snapshot.driver).toEqual({ kind: "desktop" });
    expect(resizeEffects(passive.effects)).toEqual([]);

    advance(10);
    const acted = manager.markMobileActed("s1", "phone-b");
    expect(acted.snapshot.driver).toEqual({
      kind: "mobile",
      clientId: "phone-b",
    });
    expect(acted.snapshot.layout).toEqual({
      kind: "mobile",
      ownerClientId: "phone-b",
      cols: 38,
      rows: 18,
    });
    expect(resizeEffects(acted.effects)).toEqual([
      { type: "resize", sessionId: "s1", cols: 38, rows: 18 },
    ]);
  });

  it("keeps desktop driver after reclaimed terminal's last mobile leaves", () => {
    manager.recordDesktopGeometry("s1", { cols: 150, rows: 40 });
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });
    manager.reclaimForDesktop("s1");

    manager.unsubscribeMobile("s1", "phone-a");
    advance(250);

    expect(manager.get("s1")).toMatchObject({
      driver: { kind: "desktop" },
      layout: { kind: "desktop", cols: 150, rows: 40 },
      subscribers: [],
    });
  });

  it("records desktop geometry during mobile ownership without resizing", () => {
    manager.recordDesktopGeometry("s1", { cols: 150, rows: 40 });
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });

    const recorded = manager.recordDesktopGeometry("s1", {
      cols: 160,
      rows: 50,
    });
    expect(recorded.snapshot.driver).toEqual({
      kind: "mobile",
      clientId: "phone-a",
    });
    expect(recorded.snapshot.layout).toEqual({
      kind: "mobile",
      ownerClientId: "phone-a",
      cols: 45,
      rows: 20,
    });
    expect(resizeEffects(recorded.effects)).toEqual([]);

    const reclaimed = manager.reclaimForDesktop("s1");
    expect(reclaimed.snapshot.layout).toEqual({
      kind: "desktop",
      cols: 160,
      rows: 50,
    });
    expect(resizeEffects(reclaimed.effects)).toEqual([
      { type: "resize", sessionId: "s1", cols: 160, rows: 50 },
    ]);
  });

  it("uses latest mobile actor for active phone layout", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });
    advance(10);
    const update = manager.subscribeMobile("s1", "phone-b", {
      cols: 38,
      rows: 18,
    });

    expect(update.snapshot.driver).toEqual({
      kind: "mobile",
      clientId: "phone-b",
    });
    expect(update.snapshot.layout).toEqual({
      kind: "mobile",
      ownerClientId: "phone-b",
      cols: 38,
      rows: 18,
    });
  });

  it("re-elects another mobile subscriber when the active owner leaves", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });
    advance(10);
    manager.subscribeMobile("s1", "phone-b", { cols: 38, rows: 18 });

    const update = manager.unsubscribeMobile("s1", "phone-b");

    expect(update.snapshot.driver).toEqual({
      kind: "mobile",
      clientId: "phone-a",
    });
    expect(update.snapshot.layout).toEqual({
      kind: "mobile",
      ownerClientId: "phone-a",
      cols: 45,
      rows: 20,
    });
    expect(resizeEffects(update.effects)).toEqual([
      { type: "resize", sessionId: "s1", cols: 45, rows: 20 },
    ]);
  });

  it("last mobile unsubscribe soft-leaves before idling", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });

    const update = manager.unsubscribeMobile("s1", "phone-a");

    expect(update.snapshot.driver).toEqual({
      kind: "mobile",
      clientId: "phone-a",
    });
    expect(update.snapshot.subscribers).toEqual([]);
    expect(
      manager.canWrite("s1", { kind: "mobile", clientId: "phone-a" }),
    ).toBe(false);

    advance(249);
    expect(manager.get("s1").driver).toEqual({
      kind: "mobile",
      clientId: "phone-a",
    });

    advance(1);
    expect(manager.get("s1")).toMatchObject({
      driver: { kind: "idle" },
      layout: null,
      subscribers: [],
    });
  });

  it("same-client resubscribe during soft-leave avoids idle flap", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });
    manager.unsubscribeMobile("s1", "phone-a");
    advance(100);

    manager.subscribeMobile("s1", "phone-a", { cols: 44, rows: 19 });
    advance(500);

    expect(manager.get("s1").driver).toEqual({
      kind: "mobile",
      clientId: "phone-a",
    });
    expect(manager.get("s1").layout).toEqual({
      kind: "mobile",
      ownerClientId: "phone-a",
      cols: 44,
      rows: 19,
    });
  });

  it("updates active mobile viewport in place", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });

    const update = manager.updateMobileViewport("s1", "phone-a", {
      cols: 46,
      rows: 21,
    });

    expect(update.snapshot.layout).toEqual({
      kind: "mobile",
      ownerClientId: "phone-a",
      cols: 46,
      rows: 21,
    });
    expect(resizeEffects(update.effects)).toEqual([
      { type: "resize", sessionId: "s1", cols: 46, rows: 21 },
    ]);
  });

  it("gates desktop writes while mobile owns the floor", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });

    expect(
      manager.canWrite("s1", { kind: "desktop", clientId: "desktop-a" }),
    ).toBe(false);
    expect(
      manager.canWrite("s1", { kind: "mobile", clientId: "phone-a" }),
    ).toBe(true);

    manager.reclaimForDesktop("s1");
    expect(
      manager.canWrite("s1", { kind: "desktop", clientId: "desktop-a" }),
    ).toBe(true);
  });

  it("resetSession clears subscribers, timers, driver, and layout", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });
    manager.unsubscribeMobile("s1", "phone-a");

    const reset = manager.resetSession("s1");
    expect(reset.snapshot).toEqual({
      sessionId: "s1",
      driver: { kind: "idle" },
      layout: null,
      subscribers: [],
    });
    expect(manager.getAll()).toEqual({});

    advance(1_000);
    expect(manager.get("s1")).toEqual(reset.snapshot);
  });

  it("emits asynchronous presence change after soft-leave expires", () => {
    manager.subscribeMobile("s1", "phone-a", { cols: 45, rows: 20 });
    effects = [];
    manager.unsubscribeMobile("s1", "phone-a");

    advance(250);

    expect(
      effects.some(
        (effect) =>
          effect.type === "presence-changed" &&
          effect.snapshot.driver.kind === "idle",
      ),
    ).toBe(true);
  });
});
