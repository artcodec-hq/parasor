import { describe, expect, it } from "vitest";
import {
  FONT_PRESETS,
  findPreset,
  isValidPresetId,
  toPublicPreset,
} from "./catalog.js";

describe("font catalog", () => {
  it("lists exactly 5 presets across asian + latin categories", () => {
    expect(FONT_PRESETS).toHaveLength(5);
    const asian = FONT_PRESETS.filter((p) => p.category === "asian");
    const latin = FONT_PRESETS.filter((p) => p.category === "latin");
    expect(asian).toHaveLength(3);
    expect(latin).toHaveLength(2);
  });

  it("uses https github release URLs for every preset", () => {
    for (const preset of FONT_PRESETS) {
      expect(preset.zipUrl).toMatch(
        /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//,
      );
    }
  });

  it("has unique ids with no path-traversal characters", () => {
    const ids = new Set<string>();
    for (const preset of FONT_PRESETS) {
      expect(preset.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(ids.has(preset.id)).toBe(false);
      ids.add(preset.id);
    }
  });

  it("accepts known ids and rejects anything outside the whitelist", () => {
    expect(isValidPresetId("udev-gothic")).toBe(true);
    expect(isValidPresetId("fira-code")).toBe(true);
    expect(isValidPresetId("")).toBe(false);
    expect(isValidPresetId("../etc/passwd")).toBe(false);
    expect(isValidPresetId("udev-gothic/../evil")).toBe(false);
    expect(isValidPresetId(42)).toBe(false);
    expect(isValidPresetId(null)).toBe(false);
  });

  it("findPreset returns matching entry or undefined", () => {
    expect(findPreset("udev-gothic")?.family).toBe("UDEV Gothic");
    expect(findPreset("not-a-font")).toBeUndefined();
  });

  it("toPublicPreset strips server-internal fields", () => {
    const preset = FONT_PRESETS[0];
    const pub = toPublicPreset(preset);
    expect(pub).not.toHaveProperty("zipUrl");
    expect(pub).not.toHaveProperty("regularMatch");
    expect(pub.id).toBe(preset.id);
    expect(pub.family).toBe(preset.family);
  });
});
