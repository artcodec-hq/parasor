import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MediaPreviewPane } from "./MediaPreviewPane.js";

vi.mock("../../../hooks/useVirtualKeyboard.js", () => ({
  useVirtualKeyboard: () => ({ height: 0 }),
}));

function stubFetch(stat: { size: number; mtimeMs?: number; isFile?: boolean }) {
  return vi.fn(async () => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        size: stat.size,
        mtimeMs: stat.mtimeMs ?? 0,
        isFile: stat.isFile ?? true,
      }),
    } as Response;
  }) as unknown as typeof fetch;
}

function must<T>(value: T | null | undefined): T {
  if (value == null) throw new Error("expected test element");
  return value;
}

const originalFetch = global.fetch;
const originalPdfViewerEnabled = Object.getOwnPropertyDescriptor(
  Navigator.prototype,
  "pdfViewerEnabled",
);

function setPdfViewerEnabled(value: boolean | undefined) {
  Object.defineProperty(Navigator.prototype, "pdfViewerEnabled", {
    configurable: true,
    get: () => value,
  });
}

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  if (originalPdfViewerEnabled) {
    Object.defineProperty(
      Navigator.prototype,
      "pdfViewerEnabled",
      originalPdfViewerEnabled,
    );
  } else {
    delete (Navigator.prototype as { pdfViewerEnabled?: boolean })
      .pdfViewerEnabled;
  }
  vi.restoreAllMocks();
});

describe("MediaPreviewPane (media preview behavior)", () => {
  beforeEach(() => {
    global.fetch = stubFetch({ size: 1024 });
  });

  it("renders an <img> for an image file pointing at /api/files/raw", async () => {
    const { findByAltText } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        filePath="assets/logo.png"
        kind="image"
      />,
    );
    const img = (await findByAltText("logo.png")) as HTMLImageElement;
    expect(img.src).toContain("/api/files/raw");
    expect(img.src).toContain("path=assets%2Flogo.png");
    expect(img.src).toContain("projectId=proj-1");
  });

  it("renders a <video> with controls + playsInline for a video file", async () => {
    const { container } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        filePath="movies/clip.mp4"
        kind="video"
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("video")).not.toBeNull();
    });
    const video = must(container.querySelector("video"));
    expect(video.hasAttribute("controls")).toBe(true);
    expect(video.getAttribute("playsinline")).not.toBeNull();
    expect(video.getAttribute("src")).toContain("/api/files/raw");
  });

  it("renders an <audio> with controls for an audio file", async () => {
    const { container } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        filePath="bgm/track.mp3"
        kind="audio"
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("audio")).not.toBeNull();
    });
    const audio = must(container.querySelector("audio"));
    expect(audio.hasAttribute("controls")).toBe(true);
  });

  it("gates rendering when the file exceeds the soft size limit", async () => {
    global.fetch = stubFetch({ size: 100 * 1024 * 1024 });
    const { findByText } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        filePath="big/photo.jpg"
        kind="image"
      />,
    );
    expect(await findByText(/Open anyway/i)).toBeTruthy();
  });

  it("threads worktreePath into the raw URL", async () => {
    const { findByAltText } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        worktreePath="/tmp/wt"
        filePath="logo.png"
        kind="image"
      />,
    );
    const img = (await findByAltText("logo.png")) as HTMLImageElement;
    expect(img.src).toContain("worktreePath=%2Ftmp%2Fwt");
  });

  it("renders a PDF iframe without a strict empty sandbox", async () => {
    const { container } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        filePath="docs/spec.pdf"
        kind="pdf"
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("iframe")).not.toBeNull();
    });
    const iframe = must(container.querySelector("iframe"));
    expect(iframe.getAttribute("src")).toContain("/api/files/raw");
    expect(iframe.hasAttribute("sandbox")).toBe(false);
  });

  it("threads worktreePath into the PDF raw URL", async () => {
    const { container } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        worktreePath="/tmp/wt"
        filePath="docs/spec.pdf"
        kind="pdf"
      />,
    );
    await waitFor(() => {
      expect(container.querySelector("iframe")).not.toBeNull();
    });
    const iframe = must(container.querySelector("iframe"));
    expect(iframe.getAttribute("src")).toContain("worktreePath=%2Ftmp%2Fwt");
  });

  it("shows a fallback when inline PDF viewing is unavailable", async () => {
    setPdfViewerEnabled(false);
    const { container, findByText } = render(
      <MediaPreviewPane
        paneId="p1"
        projectId="proj-1"
        filePath="docs/spec.pdf"
        kind="pdf"
      />,
    );
    expect(
      await findByText("PDF preview is unavailable in this browser."),
    ).toBeTruthy();
    expect(await findByText("Open PDF")).toBeTruthy();
    expect(container.querySelector("iframe")).toBeNull();
  });
});
