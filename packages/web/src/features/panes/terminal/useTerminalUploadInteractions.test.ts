import { act, cleanup, renderHook } from "@testing-library/react";
import type { DragEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILE_DRAG_MIME } from "../../../hooks/useOsFileDrop.js";
import {
  UploadAbortedError,
  type UploadDropsOptions,
  uploadDrops,
} from "../../../lib/uploadDrops.js";
import { useTerminalUploadInteractions } from "./useTerminalUploadInteractions.js";

vi.mock("../../../lib/uploadDrops.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../lib/uploadDrops.js")>();
  return {
    ...actual,
    uploadDrops: vi.fn(),
  };
});

const mockUploadDrops = vi.mocked(uploadDrops);

function makeFile(name = "drop.txt"): File {
  return new File(["data"], name, { type: "text/plain" });
}

function makeFileList(files: readonly File[]): FileList {
  const list = {
    length: files.length,
    item: (index: number) => files[index] ?? null,
  } as FileList;
  files.forEach((file, index) => {
    Object.defineProperty(list, index, {
      configurable: true,
      value: file,
    });
  });
  return list;
}

function makeDragEvent(input: {
  types: string[];
  files?: readonly File[];
  data?: Record<string, string>;
}) {
  const event = {
    preventDefault: vi.fn(),
    dataTransfer: {
      types: input.types,
      files: makeFileList(input.files ?? []),
      getData: (type: string) => input.data?.[type] ?? "",
      dropEffect: "none",
    },
  };
  return event as unknown as DragEvent<HTMLDivElement>;
}

function renderUploadHook(input?: {
  projectId?: string;
  sessionId?: string;
  dropEnabled?: boolean;
  sendInput?: (data: string) => void;
  focusTerminal?: () => void;
}) {
  return renderHook(() =>
    useTerminalUploadInteractions({
      projectId: input && "projectId" in input ? input.projectId : "p1",
      sessionId: input?.sessionId ?? "s1",
      dropEnabled: input?.dropEnabled ?? true,
      sendInput: input?.sendInput ?? vi.fn(),
      focusTerminal: input?.focusTerminal ?? vi.fn(),
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("useTerminalUploadInteractions", () => {
  it("uploads files, sanitizes returned paths, and inserts shell-escaped input", async () => {
    mockUploadDrops.mockResolvedValue(["/tmp/a b.txt", "", "bad\npath"]);
    const sendInput = vi.fn();
    const focusTerminal = vi.fn();
    const { result } = renderUploadHook({ sendInput, focusTerminal });

    await act(async () => {
      await result.current.runUpload([makeFile()]);
    });

    expect(mockUploadDrops).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "p1",
        sessionId: "s1",
        files: [expect.any(File)],
      }),
    );
    expect(sendInput).toHaveBeenCalledWith("'/tmp/a b.txt'");
    expect(focusTerminal).toHaveBeenCalledTimes(1);
    expect(result.current.uploadState).toEqual({ status: "idle" });
  });

  it("surfaces project-less uploads as a temporary error", async () => {
    vi.useFakeTimers();
    const { result } = renderUploadHook({ projectId: undefined });

    await act(async () => {
      await result.current.runUpload([makeFile()]);
    });

    expect(mockUploadDrops).not.toHaveBeenCalled();
    expect(result.current.uploadState).toEqual({
      status: "error",
      message: "Cannot upload: project unknown",
    });

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.uploadState).toEqual({ status: "idle" });
  });

  it("resets to idle for aborted uploads", async () => {
    mockUploadDrops.mockRejectedValue(new UploadAbortedError());
    const { result } = renderUploadHook();

    await act(async () => {
      await result.current.runUpload([makeFile()]);
    });

    expect(result.current.uploadState).toEqual({ status: "idle" });
  });

  it("aborts an in-flight upload on unmount", () => {
    let capturedSignal: AbortSignal | undefined;
    mockUploadDrops.mockImplementation((opts: UploadDropsOptions) => {
      capturedSignal = opts.signal;
      return new Promise(() => {});
    });
    const { result, unmount } = renderUploadHook();

    act(() => {
      void result.current.runUpload([makeFile()]);
    });

    expect(capturedSignal?.aborted).toBe(false);
    unmount();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it("keeps dropEnabledRef and runUploadRef stable across readiness changes", () => {
    const sendInput = vi.fn();
    const focusTerminal = vi.fn();
    const { result, rerender } = renderHook(
      ({ dropEnabled }) =>
        useTerminalUploadInteractions({
          projectId: "p1",
          sessionId: "s1",
          dropEnabled,
          sendInput,
          focusTerminal,
        }),
      { initialProps: { dropEnabled: false } },
    );
    const dropEnabledRef = result.current.dropEnabledRef;
    const runUploadRef = result.current.runUploadRef;

    rerender({ dropEnabled: true });

    expect(result.current.dropEnabledRef).toBe(dropEnabledRef);
    expect(dropEnabledRef.current).toBe(true);
    expect(result.current.runUploadRef).toBe(runUploadRef);
  });

  it("ignores OS file drops while dropping is disabled", () => {
    const { result } = renderUploadHook({ dropEnabled: false });
    const event = makeDragEvent({ types: ["Files"], files: [makeFile()] });

    act(() => {
      result.current.dragHandlers.onDrop(event);
    });

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(mockUploadDrops).not.toHaveBeenCalled();
  });

  it("uploads OS file drops while dropping is enabled", async () => {
    mockUploadDrops.mockResolvedValue(["/tmp/uploaded.txt"]);
    const sendInput = vi.fn();
    const { result } = renderUploadHook({ sendInput });
    const event = makeDragEvent({ types: ["Files"], files: [makeFile()] });

    await act(async () => {
      result.current.dragHandlers.onDrop(event);
      await Promise.resolve();
    });

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(mockUploadDrops).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith("'/tmp/uploaded.txt'");
  });

  it("inserts sanitized internal path drops without uploading", () => {
    const sendInput = vi.fn();
    const focusTerminal = vi.fn();
    const { result } = renderUploadHook({ sendInput, focusTerminal });
    const event = makeDragEvent({
      types: [FILE_DRAG_MIME],
      data: {
        [FILE_DRAG_MIME]: JSON.stringify([
          "/repo/file one.ts",
          "",
          "bad\rpath",
          123,
        ]),
      },
    });

    act(() => {
      result.current.dragHandlers.onDrop(event);
    });

    expect(mockUploadDrops).not.toHaveBeenCalled();
    expect(sendInput).toHaveBeenCalledWith("'/repo/file one.ts'");
    expect(focusTerminal).toHaveBeenCalledTimes(1);
  });

  it("falls back to sanitized text/plain drops", () => {
    const sendInput = vi.fn();
    const { result } = renderUploadHook({ sendInput });
    const event = makeDragEvent({
      types: ["text/plain"],
      data: { "text/plain": "/repo/file two.ts" },
    });

    act(() => {
      result.current.dragHandlers.onDrop(event);
    });

    expect(sendInput).toHaveBeenCalledWith("'/repo/file two.ts'");
  });

  it("drops control-char-bearing text/plain paths", () => {
    const sendInput = vi.fn();
    const { result } = renderUploadHook({ sendInput });
    const event = makeDragEvent({
      types: ["text/plain"],
      data: { "text/plain": "/repo/file\nthree.ts" },
    });

    act(() => {
      result.current.dragHandlers.onDrop(event);
    });

    expect(sendInput).not.toHaveBeenCalled();
  });
});
