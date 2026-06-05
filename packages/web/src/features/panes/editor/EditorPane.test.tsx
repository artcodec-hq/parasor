import type { Project } from "@parasor/shared";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsProvider } from "../../workspace/projects-context.js";
import { EditorPane } from "./EditorPane.js";

// FileEditor is mocked so the dirty branch can be triggered without driving CodeMirror.
const editorOnChangeRef: { current: ((next: string) => void) | null } = {
  current: null,
};

vi.mock("./FileEditor.js", () => ({
  FileEditor: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (next: string) => void;
  }) => {
    editorOnChangeRef.current = onChange;
    return <div data-testid="file-editor-mock">{value}</div>;
  },
}));

vi.mock("./MarkdownPreview.js", () => ({
  MarkdownPreview: ({ value }: { value: string }) => (
    <div data-testid="markdown-preview-mock">{value}</div>
  ),
}));

vi.mock("../../../hooks/useVirtualKeyboard.js", () => ({
  useVirtualKeyboard: () => ({ height: 0 }),
}));

const project: Project = {
  id: "p1",
  name: "demo",
  path: "/tmp/demo",
  createdAt: 0,
  lastAccessedAt: 0,
};

function editorTree(filePath = "src/foo.ts", fileChangeSeq?: number) {
  return (
    <ProjectsProvider projects={[project]}>
      <EditorPane
        paneId="pane-1"
        projectId="p1"
        filePath={filePath}
        {...(fileChangeSeq !== undefined ? { fileChangeSeq } : {})}
      />
    </ProjectsProvider>
  );
}

function renderEditor(filePath = "src/foo.ts", fileChangeSeq?: number) {
  return render(editorTree(filePath, fileChangeSeq));
}

describe("EditorPane dirty indicator (dirty indicator behavior)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    editorOnChangeRef.current = null;
    global.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => "hello",
      } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("omits the Modified glyph when value matches the original", async () => {
    const { queryByLabelText, findByTestId } = renderEditor();
    await findByTestId("file-editor-mock");
    expect(queryByLabelText("Modified")).toBeNull();
  });

  it("renders the canonical Modified glyph once the buffer diverges", async () => {
    const { findByLabelText, findByTestId } = renderEditor();
    await findByTestId("file-editor-mock");
    await waitFor(() => {
      expect(editorOnChangeRef.current).not.toBeNull();
    });
    act(() => {
      editorOnChangeRef.current?.("hello world");
    });
    const marker = await findByLabelText("Modified");
    expect(marker.getAttribute("title")).toBe("Has unsaved changes");
    expect(marker.className).toContain("text-warning");
    expect(marker.querySelector("svg")).not.toBeNull();
  });
});

describe("EditorPane markdown preview toggle (markdown preview behavior)", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    editorOnChangeRef.current = null;
    global.fetch = vi.fn(async () => {
      return {
        ok: true,
        status: 200,
        text: async () => "# Hello\n",
      } as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("hides the preview toggle on non-markdown files", async () => {
    const { findByTestId, queryByLabelText } = renderEditor("src/foo.ts");
    await findByTestId("file-editor-mock");
    expect(queryByLabelText("Show preview")).toBeNull();
    expect(queryByLabelText("Show source")).toBeNull();
  });

  it("renders the toggle for .md files and starts in source mode", async () => {
    const { findByTestId, findByLabelText, queryByTestId } =
      renderEditor("docs/readme.md");
    await findByTestId("file-editor-mock");
    await findByLabelText("Show preview");
    expect(queryByTestId("markdown-preview-mock")).toBeNull();
  });

  it("renders the toggle for .markdown files", async () => {
    const { findByTestId, findByLabelText } = renderEditor("notes.markdown");
    await findByTestId("file-editor-mock");
    await findByLabelText("Show preview");
  });

  it("renders the toggle for .mdx files", async () => {
    const { findByTestId, findByLabelText } = renderEditor("post.mdx");
    await findByTestId("file-editor-mock");
    await findByLabelText("Show preview");
  });

  it("swaps to MarkdownPreview when the toggle is pressed and back on second press", async () => {
    const { findByTestId, findByLabelText, queryByTestId } =
      renderEditor("docs/readme.md");
    await findByTestId("file-editor-mock");
    const showBtn = await findByLabelText("Show preview");
    fireEvent.click(showBtn);
    await findByTestId("markdown-preview-mock");
    expect(queryByTestId("file-editor-mock")).toBeNull();
    const hideBtn = await findByLabelText("Show source");
    fireEvent.click(hideBtn);
    await findByTestId("file-editor-mock");
    expect(queryByTestId("markdown-preview-mock")).toBeNull();
  });

  it("keeps Markdown preview mounted when an external refresh returns identical content", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "# Hello\n",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "# Hello\n",
      } as Response);
    global.fetch = fetchMock as unknown as typeof fetch;

    const {
      findByTestId,
      findByLabelText,
      getByTestId,
      queryByText,
      rerender,
    } = renderEditor("docs/readme.md", 0);
    await findByTestId("file-editor-mock");
    fireEvent.click(await findByLabelText("Show preview"));
    const preview = await findByTestId("markdown-preview-mock");
    preview.scrollTop = 72;

    rerender(editorTree("docs/readme.md", 1));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    expect(queryByText("Loading…")).toBeNull();
    expect(getByTestId("markdown-preview-mock")).toBe(preview);
    expect(preview.scrollTop).toBe(72);
  });
});
