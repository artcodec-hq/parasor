import { describe, expect, it } from "vitest";
import { applyCtrlModifier } from "./terminal-ctrl-modifier.js";

describe("applyCtrlModifier", () => {
  it("maps lowercase a-z to \\x01-\\x1a", () => {
    expect(applyCtrlModifier("a")).toBe("\x01");
    expect(applyCtrlModifier("c")).toBe("\x03"); // Ctrl+C
    expect(applyCtrlModifier("z")).toBe("\x1a");
  });

  it("maps uppercase A-Z to the same \\x01-\\x1a controls", () => {
    expect(applyCtrlModifier("A")).toBe("\x01");
    expect(applyCtrlModifier("C")).toBe("\x03");
    expect(applyCtrlModifier("Z")).toBe("\x1a");
  });

  it("maps the classic special Ctrl combos", () => {
    expect(applyCtrlModifier("@")).toBe("\x00");
    expect(applyCtrlModifier("[")).toBe("\x1b");
    expect(applyCtrlModifier("\\")).toBe("\x1c");
    expect(applyCtrlModifier("]")).toBe("\x1d");
    expect(applyCtrlModifier("^")).toBe("\x1e");
    expect(applyCtrlModifier("_")).toBe("\x1f");
    expect(applyCtrlModifier("?")).toBe("\x7f");
  });

  it("passes single chars with no Ctrl mapping through unchanged", () => {
    expect(applyCtrlModifier("1")).toBe("1");
    expect(applyCtrlModifier(" ")).toBe(" ");
    expect(applyCtrlModifier("!")).toBe("!");
  });

  it("passes multi-char data through untouched (paste / IME)", () => {
    expect(applyCtrlModifier("abc")).toBe("abc");
    expect(applyCtrlModifier("こんにちは")).toBe("こんにちは");
  });

  it("passes empty string through untouched", () => {
    expect(applyCtrlModifier("")).toBe("");
  });
});
