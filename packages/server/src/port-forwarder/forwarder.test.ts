import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PortForwarder } from "./forwarder.js";

afterEach(() => vi.restoreAllMocks());

describe("suspended automatic forwarding", () => {
  it.each([
    null,
    "0.0.0.0",
    "::",
    "100.64.0.1",
  ])("never creates a listener or advertises a forwarded port for %s", (bindHost) => {
    const createServer = vi.spyOn(net, "createServer");
    const onChange = vi.fn();
    const forwarder = new PortForwarder(bindHost);
    forwarder.setOnChange(onChange);
    forwarder.sync("p1", [
      { port: 5173, bindsAll: false },
      { port: 3000, bindsAll: true },
    ]);
    expect(forwarder.isInert()).toBe(bindHost === null);
    expect(forwarder.getReachablePort("p1", 5173)).toBeNull();
    expect(forwarder.getForwarderState("p1", 5173)).toEqual({ status: "none" });
    forwarder.sync("p1", []);
    forwarder.stop();
    expect(createServer).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});
