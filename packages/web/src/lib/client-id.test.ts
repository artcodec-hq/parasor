import { afterEach, describe, expect, it, vi } from "vitest";

const CLIENT_ID_KEY = "parasor:client-id";
const LEGACY_PREFS_KEY = "parasor:preferences";

function makeStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    clear: vi.fn(() => store.clear()),
  };
}

// Each test re-imports the module so the in-module `cachedClientId` starts
// fresh -- the cache is per browser-tab in production, per test here.
async function load() {
  vi.resetModules();
  return import("./client-id.js");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("getClientId", () => {
  it("returns the value stored under the dedicated key", async () => {
    vi.stubGlobal(
      "localStorage",
      makeStorage({ [CLIENT_ID_KEY]: "stored-id" }),
    );
    const { getClientId } = await load();
    expect(getClientId()).toBe("stored-id");
  });

  it("migrates the id from the legacy prefs blob and writes the dedicated key", async () => {
    const storage = makeStorage({
      [LEGACY_PREFS_KEY]: JSON.stringify({ clientId: "legacy-id", theme: "x" }),
    });
    vi.stubGlobal("localStorage", storage);
    const { getClientId } = await load();
    expect(getClientId()).toBe("legacy-id");
    expect(storage.store.get(CLIENT_ID_KEY)).toBe("legacy-id");
  });

  it("ignores a legacy blob without a string clientId and generates a fresh id", async () => {
    const storage = makeStorage({
      [LEGACY_PREFS_KEY]: JSON.stringify({ clientId: 42 }),
    });
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("crypto", { randomUUID: () => "fresh-id" });
    const { getClientId } = await load();
    expect(getClientId()).toBe("fresh-id");
    expect(storage.store.get(CLIENT_ID_KEY)).toBe("fresh-id");
  });

  it("generates and persists a new id when none exists", async () => {
    const storage = makeStorage();
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("crypto", { randomUUID: () => "gen-id" });
    const { getClientId } = await load();
    expect(getClientId()).toBe("gen-id");
    expect(storage.store.get(CLIENT_ID_KEY)).toBe("gen-id");
  });

  it("caches within a module instance and skips further storage reads", async () => {
    const storage = makeStorage({ [CLIENT_ID_KEY]: "cached-id" });
    vi.stubGlobal("localStorage", storage);
    const { getClientId } = await load();
    expect(getClientId()).toBe("cached-id");
    const readsAfterFirst = storage.getItem.mock.calls.length;
    expect(getClientId()).toBe("cached-id");
    expect(storage.getItem.mock.calls.length).toBe(readsAfterFirst);
  });

  it("tolerates localStorage getItem/setItem throwing and still returns an id", async () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => {
        throw new Error("access denied");
      }),
      setItem: vi.fn(() => {
        throw new Error("access denied");
      }),
    });
    vi.stubGlobal("crypto", { randomUUID: () => "fallback-id" });
    const { getClientId } = await load();
    expect(() => getClientId()).not.toThrow();
    expect(getClientId()).toBe("fallback-id");
  });
});

describe("generateUUID", () => {
  it("prefers crypto.randomUUID when available", async () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "native-uuid",
      getRandomValues: vi.fn(),
    });
    const { generateUUID } = await load();
    expect(generateUUID()).toBe("native-uuid");
    expect(
      globalThis.crypto.getRandomValues as ReturnType<typeof vi.fn>,
    ).not.toHaveBeenCalled();
  });

  it("synthesizes a v4 UUID via getRandomValues in non-secure contexts", async () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) arr[i] = i;
        return arr;
      },
    });
    const { generateUUID } = await load();
    expect(generateUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
