import { describe, expect, it } from "vitest";
import { printHelp, printHelpAll } from "./help.js";

describe("printHelp", () => {
  it("lists user-facing commands and core flags only", () => {
    const lines: string[] = [];
    printHelp((l) => lines.push(l));
    const output = lines.join("\n");

    for (const sub of ["qr", "service", "restart", "stop", "help"]) {
      expect(output).toContain(sub);
    }
    expect(output).toContain("--host");
    expect(output).toContain("--port");
    expect(output).toContain("--no-qr");
    expect(output).toContain("--qr=<iface>");
    expect(output).toContain("--help-all");
  });

  it("hides advanced and internal commands from the default help", () => {
    const lines: string[] = [];
    printHelp((l) => lines.push(l));
    const output = lines.join("\n");

    /*
     * notify / pty-host / open are advanced -- power users find them via
     * --help-all. hook / shim-open are internal bridges invoked by agents
     * or PATH shims; surfacing them on the default help confused users
     * into thinking they were direct-invoke commands. Keep the user-
     * facing surface to four entries.
     */
    for (const sub of ["notify", "pty-host", "open ", "hook ", "shim-open"]) {
      expect(output).not.toContain(sub);
    }
    expect(output).not.toContain("PARASOR_AUTH");
  });
});

describe("printHelpAll", () => {
  it("includes both user-facing and advanced/internal commands", () => {
    const lines: string[] = [];
    printHelpAll((l) => lines.push(l));
    const output = lines.join("\n");

    for (const sub of [
      "qr",
      "service",
      "restart",
      "notify",
      "pty-host",
      "open",
      "hook",
      "shim-open",
    ]) {
      expect(output).toContain(sub);
    }
    expect(output).toContain("PARASOR_AUTH");
    expect(output).toContain("PARASOR_CONFIG_DIR");
  });
});
