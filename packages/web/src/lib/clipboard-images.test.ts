import { describe, expect, it } from "vitest";
import { extractImageFiles } from "./clipboard-images.js";

function makeItem(
  type: string,
  size = 32,
  kind: "file" | "string" = "file",
): DataTransferItem {
  return {
    kind,
    type,
    getAsFile: () =>
      kind === "file" ? new File([new Uint8Array(size)], "", { type }) : null,
  } as unknown as DataTransferItem;
}

function makeItemNullFile(type: string): DataTransferItem {
  return {
    kind: "file",
    type,
    getAsFile: () => null,
  } as unknown as DataTransferItem;
}

function makeDataTransfer(items: DataTransferItem[]): DataTransfer {
  return {
    items: items as unknown as DataTransferItemList,
  } as unknown as DataTransfer;
}

describe("extractImageFiles", () => {
  it("returns empty array when clipboardData is null", () => {
    expect(extractImageFiles(null)).toEqual([]);
  });

  it("returns empty array when no image items present (text only)", () => {
    const dt = makeDataTransfer([makeItem("text/plain", 16, "string")]);
    expect(extractImageFiles(dt)).toEqual([]);
  });

  it("ignores non-file items (kind=string)", () => {
    const dt = makeDataTransfer([makeItem("image/png", 16, "string")]);
    expect(extractImageFiles(dt)).toEqual([]);
  });

  it("returns File[] for image/png", () => {
    const dt = makeDataTransfer([makeItem("image/png")]);
    const files = extractImageFiles(dt);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("paste.png");
    expect(files[0]?.type).toBe("image/png");
  });

  it("returns File[] for image/jpeg", () => {
    const dt = makeDataTransfer([makeItem("image/jpeg")]);
    const files = extractImageFiles(dt);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("paste.jpg");
    expect(files[0]?.type).toBe("image/jpeg");
  });

  it("returns File[] for image/gif", () => {
    const dt = makeDataTransfer([makeItem("image/gif")]);
    const files = extractImageFiles(dt);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("paste.gif");
    expect(files[0]?.type).toBe("image/gif");
  });

  it("returns File[] for image/webp", () => {
    const dt = makeDataTransfer([makeItem("image/webp")]);
    const files = extractImageFiles(dt);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("paste.webp");
    expect(files[0]?.type).toBe("image/webp");
  });

  it("returns File[] for image/avif", () => {
    const dt = makeDataTransfer([makeItem("image/avif")]);
    const files = extractImageFiles(dt);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("paste.avif");
    expect(files[0]?.type).toBe("image/avif");
  });

  it("returns .bin extension for unknown image/* MIME", () => {
    const dt = makeDataTransfer([makeItem("image/x-unknown")]);
    const files = extractImageFiles(dt);
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe("paste.bin");
    expect(files[0]?.type).toBe("image/x-unknown");
  });

  it("skips items where getAsFile() returns null", () => {
    const dt = makeDataTransfer([makeItemNullFile("image/png")]);
    expect(extractImageFiles(dt)).toEqual([]);
  });

  it("returns ALL images when multiple images are in the clipboard", () => {
    const dt = makeDataTransfer([
      makeItem("image/png"),
      makeItem("image/jpeg"),
      makeItem("image/webp"),
    ]);
    const files = extractImageFiles(dt);
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.name)).toEqual([
      "paste.png",
      "paste.jpg",
      "paste.webp",
    ]);
  });

  it("respects maxBytes: skips oversize, keeps under-size", () => {
    const dt = makeDataTransfer([
      makeItem("image/png", 10),
      makeItem("image/jpeg", 100),
      makeItem("image/gif", 50),
    ]);
    const files = extractImageFiles(dt, 50);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.name)).toEqual(["paste.png", "paste.gif"]);
  });
});
