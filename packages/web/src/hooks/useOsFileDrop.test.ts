import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  classifyDrag,
  FILE_DRAG_MIME,
  isOsFileDrop,
  useOsFileDrop,
} from "./useOsFileDrop.js";

function makeDt(types: readonly string[], files: File[] = []): DataTransfer {
  // jsdom's DataTransfer is patchy; fabricate the minimum surface the hook reads.
  const fileList = {
    length: files.length,
    item: (i: number) => files[i] ?? null,
    [Symbol.iterator]: function* () {
      for (const f of files) yield f;
    },
  } as unknown as FileList;
  return {
    types,
    files: fileList,
    dropEffect: "none",
    effectAllowed: "all",
  } as unknown as DataTransfer;
}

function makeEvent(dt: DataTransfer): {
  event: {
    dataTransfer: DataTransfer;
    preventDefault: ReturnType<typeof vi.fn>;
  };
} {
  return {
    event: {
      dataTransfer: dt,
      preventDefault: vi.fn(),
    },
  };
}

describe("classifyDrag", () => {
  it("routes internal MIME to internal regardless of other types", () => {
    expect(classifyDrag([FILE_DRAG_MIME])).toBe("internal");
    expect(classifyDrag([FILE_DRAG_MIME, "Files", "text/plain"])).toBe(
      "internal",
    );
  });

  it("routes OS Files drop to os-files", () => {
    expect(classifyDrag(["Files"])).toBe("os-files");
  });

  it("prioritizes Files over text/plain (Safari/macOS Finder case)", () => {
    // Safari's Finder drag advertises BOTH text/plain and Files; the
    // upload path must win over the text-insert path.
    expect(classifyDrag(["text/plain", "Files"])).toBe("os-files");
    expect(classifyDrag(["text/plain", "Files", "text/uri-list"])).toBe(
      "os-files",
    );
  });

  it("routes text/plain-only drags to internal", () => {
    expect(classifyDrag(["text/plain"])).toBe("internal");
  });

  it("returns none for unrecognized types", () => {
    expect(classifyDrag([])).toBe("none");
    expect(classifyDrag(["text/uri-list"])).toBe("none");
  });
});

describe("isOsFileDrop", () => {
  it("returns true for Files only", () => {
    expect(isOsFileDrop(makeDt(["Files"]))).toBe(true);
  });
  it("returns false when the internal MIME is present", () => {
    expect(isOsFileDrop(makeDt(["Files", FILE_DRAG_MIME]))).toBe(false);
  });
  it("returns false when only the internal MIME is present", () => {
    expect(isOsFileDrop(makeDt([FILE_DRAG_MIME]))).toBe(false);
  });
  it("returns false for plain text/uri-list", () => {
    expect(isOsFileDrop(makeDt(["text/uri-list"]))).toBe(false);
  });
  it("returns false for null dataTransfer", () => {
    expect(isOsFileDrop(null)).toBe(false);
  });
});

describe("useOsFileDrop", () => {
  it("calls onDrop with the dropped files", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOsFileDrop({ onDrop }));
    const file = new File(["x"], "x.txt", { type: "text/plain" });
    const dt = makeDt(["Files"], [file]);
    act(() => {
      result.current.handlers.onDrop(
        makeEvent(dt).event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(onDrop).toHaveBeenCalledWith([file]);
  });

  it("does not call onDrop when no files present", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOsFileDrop({ onDrop }));
    const dt = makeDt(["Files"], []);
    act(() => {
      result.current.handlers.onDrop(
        makeEvent(dt).event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("ignores drops that advertise the internal MIME", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOsFileDrop({ onDrop }));
    const file = new File(["x"], "x.txt");
    const dt = makeDt(["Files", FILE_DRAG_MIME], [file]);
    const ev = makeEvent(dt);
    act(() => {
      result.current.handlers.onDrop(
        ev.event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(onDrop).not.toHaveBeenCalled();
    expect(ev.event.preventDefault).not.toHaveBeenCalled();
  });

  it("tracks isDragging through enter/leave pairs", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOsFileDrop({ onDrop }));
    const dt = makeDt(["Files"]);
    expect(result.current.isDragging).toBe(false);
    act(() => {
      result.current.handlers.onDragEnter(
        makeEvent(dt).event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(result.current.isDragging).toBe(true);
    act(() => {
      result.current.handlers.onDragEnter(
        makeEvent(dt).event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(result.current.isDragging).toBe(true);
    act(() => {
      result.current.handlers.onDragLeave(
        makeEvent(dt).event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(result.current.isDragging).toBe(true);
    act(() => {
      result.current.handlers.onDragLeave(
        makeEvent(dt).event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("does not track state when disabled", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() =>
      useOsFileDrop({ onDrop, enabled: false }),
    );
    const dt = makeDt(["Files"]);
    act(() => {
      result.current.handlers.onDragEnter(
        makeEvent(dt).event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("sets dropEffect=copy on dragOver for valid drops", () => {
    const onDrop = vi.fn();
    const { result } = renderHook(() => useOsFileDrop({ onDrop }));
    const dt = makeDt(["Files"]);
    const ev = makeEvent(dt);
    act(() => {
      result.current.handlers.onDragOver(
        ev.event as unknown as React.DragEvent<HTMLElement>,
      );
    });
    expect(ev.event.preventDefault).toHaveBeenCalled();
    expect(dt.dropEffect).toBe("copy");
  });
});
