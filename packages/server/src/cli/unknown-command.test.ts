import { describe, expect, it } from "vitest";
import { classifyTopLevelCommand } from "./unknown-command.js";

describe("classifyTopLevelCommand", () => {
  it("passes through when no command given (server boot)", () => {
    expect(classifyTopLevelCommand(undefined)).toEqual({ kind: "pass" });
  });

  it("passes through when first arg is a flag", () => {
    expect(classifyTopLevelCommand("--host")).toEqual({ kind: "pass" });
    expect(classifyTopLevelCommand("--port=8080")).toEqual({ kind: "pass" });
    expect(classifyTopLevelCommand("--no-qr")).toEqual({ kind: "pass" });
    expect(classifyTopLevelCommand("-h")).toEqual({ kind: "pass" });
  });

  it("errors on unknown command with service-verb hint", () => {
    const r = classifyTopLevelCommand("status");
    expect(r.kind).toBe("error");
    if (r.kind !== "error") return;
    expect(r.message).toContain("unknown command 'status'");
    expect(r.message).toContain("parasor service status");
    expect(r.message).toContain("--help");
  });

  it.each([
    "install",
    "uninstall",
    "status",
    "logs",
  ])("hints `parasor service %s` for service verb", (verb) => {
    const r = classifyTopLevelCommand(verb);
    expect(r.kind).toBe("error");
    if (r.kind !== "error") return;
    expect(r.message).toContain(`parasor service ${verb}`);
  });

  it("errors without hint for non-service unknown command", () => {
    const r = classifyTopLevelCommand("frobnicate");
    expect(r.kind).toBe("error");
    if (r.kind !== "error") return;
    expect(r.message).toContain("unknown command 'frobnicate'");
    expect(r.message).not.toContain("Did you mean");
  });
});
