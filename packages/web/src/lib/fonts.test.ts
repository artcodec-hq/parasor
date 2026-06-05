import { describe, expect, it } from "vitest";
import {
  DEFAULT_CONTENT_FONT_STACK,
  DEFAULT_UI_FONT_STACK,
  resolveFontStack,
} from "./fonts.js";

describe("resolveFontStack", () => {
  it("returns the content default stack when no custom family is set", () => {
    expect(resolveFontStack("")).toBe(DEFAULT_CONTENT_FONT_STACK);
  });

  it("uses the requested default stack for UI font resolution", () => {
    expect(resolveFontStack("", DEFAULT_UI_FONT_STACK)).toBe(
      DEFAULT_UI_FONT_STACK,
    );
    expect(resolveFontStack("Inter, system-ui", DEFAULT_UI_FONT_STACK)).toBe(
      `Inter, system-ui, ${DEFAULT_UI_FONT_STACK}`,
    );
  });

  it("keeps platform generic families unquoted", () => {
    expect(resolveFontStack("-apple-system", DEFAULT_UI_FONT_STACK)).toBe(
      `-apple-system, ${DEFAULT_UI_FONT_STACK}`,
    );
  });
});
