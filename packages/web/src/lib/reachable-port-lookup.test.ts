import { describe, expect, it } from "vitest";
import {
  buildReachablePortLookup,
  findReachablePortForOpenUrl,
} from "./reachable-port-lookup.js";

describe("reachable port lookup", () => {
  it("prefers the terminal session project when it has the dev port", () => {
    const lookup = buildReachablePortLookup({
      active: [{ port: 5173, pid: 1, bindsAll: false, reachablePort: 49000 }],
      terminal: [{ port: 5173, pid: 2, bindsAll: false, reachablePort: 49123 }],
    });

    expect(
      findReachablePortForOpenUrl(lookup, 5173, {
        activeProjectId: "active",
        projectId: "terminal",
      }),
    ).toBe(49123);
  });

  it("falls back to the active project if the terminal project has no port table entry", () => {
    const lookup = buildReachablePortLookup({
      active: [{ port: 5173, pid: 1, bindsAll: false, reachablePort: 49000 }],
    });

    expect(
      findReachablePortForOpenUrl(lookup, 5173, {
        activeProjectId: "active",
        projectId: "terminal",
      }),
    ).toBe(49000);
  });

  it("falls back to a unique project when there is no project context", () => {
    const lookup = buildReachablePortLookup({
      only: [{ port: 3000, pid: 1, bindsAll: false, reachablePort: 49111 }],
    });

    expect(
      findReachablePortForOpenUrl(lookup, 3000, {
        activeProjectId: null,
      }),
    ).toBe(49111);
  });

  it("uses the dev port itself for all-interface dev servers", () => {
    const lookup = buildReachablePortLookup({
      p1: [{ port: 3000, pid: 1, bindsAll: true }],
    });

    expect(
      findReachablePortForOpenUrl(lookup, 3000, {
        activeProjectId: "p1",
      }),
    ).toBe(3000);
  });

  it("does not guess when a project-less lookup has conflicting same-numbered ports", () => {
    const lookup = buildReachablePortLookup({
      p1: [{ port: 5173, pid: 1, bindsAll: false, reachablePort: 49111 }],
      p2: [{ port: 5173, pid: 2, bindsAll: false, reachablePort: 49222 }],
    });

    expect(
      findReachablePortForOpenUrl(lookup, 5173, {
        activeProjectId: null,
      }),
    ).toBeUndefined();
  });
});
