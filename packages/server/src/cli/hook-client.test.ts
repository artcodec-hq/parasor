import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { postHookNotify } from "./hook-client.js";

describe("postHookNotify", () => {
  let originalPort: string | undefined;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalPort = process.env.PARASOR_PORT;
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalPort === undefined) delete process.env.PARASOR_PORT;
    else process.env.PARASOR_PORT = originalPort;
    globalThis.fetch = originalFetch;
  });

  function stubFetch(impl: typeof fetch): void {
    globalThis.fetch = impl;
  }

  it("returns ok:false when PARASOR_PORT is not set", async () => {
    delete process.env.PARASOR_PORT;
    const result = await postHookNotify({
      sessionId: "s1",
      agent: "claude",
      event: "Stop",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/PARASOR_PORT/);
  });

  it("rejects PARASOR_PORT that contains a userinfo escape (SSRF guard)", async () => {
    process.env.PARASOR_PORT = "@attacker.com:9999";
    let fetched = false;
    stubFetch(async () => {
      fetched = true;
      return new Response("{}", { status: 200 });
    });
    const result = await postHookNotify({
      sessionId: "s1",
      agent: "claude",
      event: "Stop",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a valid port number/);
    expect(fetched).toBe(false);
  });

  it("rejects non-numeric PARASOR_PORT", async () => {
    process.env.PARASOR_PORT = "abc";
    const result = await postHookNotify({
      sessionId: "s1",
      agent: "claude",
      event: "Stop",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a valid port number/);
  });

  it("rejects port 0 and ports > 65535", async () => {
    for (const bad of ["0", "65536", "99999"]) {
      process.env.PARASOR_PORT = bad;
      const result = await postHookNotify({
        sessionId: "s1",
        agent: "claude",
        event: "Stop",
      });
      expect(result.ok).toBe(false);
      expect(result.error).toMatch(/not a valid port number/);
    }
  });

  it("posts to 127.0.0.1:<port>/hook/notify with the right body on success", async () => {
    process.env.PARASOR_PORT = "12345";
    const calls: Array<{ url: string; init: RequestInit }> = [];
    stubFetch(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });

    const result = await postHookNotify({
      sessionId: "abc",
      agent: "manual",
      event: "running",
    });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://127.0.0.1:12345/hook/notify");
    expect(calls[0].init.method).toBe("POST");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toEqual({
      sessionId: "abc",
      agent: "manual",
      event: "running",
    });
  });

  it("returns ok:false with the server's error message on non-2xx", async () => {
    process.env.PARASOR_PORT = "12345";
    stubFetch(
      async () =>
        new Response(JSON.stringify({ error: "unknown session" }), {
          status: 404,
        }),
    );
    const result = await postHookNotify({
      sessionId: "ghost",
      agent: "claude",
      event: "Stop",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("404");
    expect(result.error).toContain("unknown session");
  });

  it("returns ok:false on non-2xx with malformed JSON body", async () => {
    process.env.PARASOR_PORT = "12345";
    stubFetch(async () => new Response("not json", { status: 500 }));
    const result = await postHookNotify({
      sessionId: "s1",
      agent: "claude",
      event: "Stop",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("500");
  });

  it("returns ok:false with timeout error when fetch is aborted", async () => {
    process.env.PARASOR_PORT = "12345";
    stubFetch(async (_url, init) => {
      // Simulate AbortController firing
      const signal = init?.signal as AbortSignal | undefined;
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    // We can't easily force the internal AbortController to fire mid-test
    // without waiting the full timeout. Instead, simulate by throwing
    // AbortError directly.
    stubFetch(async () => {
      const err = new Error("aborted by user");
      err.name = "AbortError";
      throw err;
    });

    const result = await postHookNotify({
      sessionId: "s1",
      agent: "claude",
      event: "Stop",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/timed out/);
  });

  it("returns ok:false on generic network error", async () => {
    process.env.PARASOR_PORT = "12345";
    stubFetch(async () => {
      throw new Error("ECONNREFUSED 127.0.0.1:12345");
    });
    const result = await postHookNotify({
      sessionId: "s1",
      agent: "claude",
      event: "Stop",
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("network error");
    expect(result.error).toContain("ECONNREFUSED");
  });
});
