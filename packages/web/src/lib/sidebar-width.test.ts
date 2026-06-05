import { describe, expect, it } from "vitest";
import {
  clampSidebarWidth,
  clampStoredSidebarWidth,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_MIN,
  sidebarWidthMax,
} from "./sidebar-width.js";

describe("sidebar-width", () => {
  it("keeps stored desktop width independent of the current viewport", () => {
    expect(clampStoredSidebarWidth(480)).toBe(480);
    expect(clampStoredSidebarWidth(999)).toBe(SIDEBAR_WIDTH_MAX);
    expect(clampStoredSidebarWidth(1)).toBe(SIDEBAR_WIDTH_MIN);
  });

  it("clamps live desktop width against workspace space", () => {
    expect(sidebarWidthMax(375)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(480, 375)).toBe(SIDEBAR_WIDTH_MIN);
    expect(clampSidebarWidth(480, 1440)).toBe(SIDEBAR_WIDTH_MAX);
  });
});
