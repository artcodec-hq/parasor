import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NewWorktreeDialog,
  type WorktreeLocalFileLoadResult,
} from "./NewWorktreeDialog.js";

const project = { id: "p1", name: "project", path: "/repo/project" };

function renderDialog(
  overrides: Partial<Parameters<typeof NewWorktreeDialog>[0]> = {},
) {
  const props = {
    open: true,
    project,
    loadLocalFiles: vi.fn(async () => ({
      candidates: [{ path: ".env", size: 9 }],
      rememberedPaths: [],
    })),
    onClose: vi.fn(),
    onCreate: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<NewWorktreeDialog {...props} />) };
}

afterEach(() => {
  cleanup();
});

describe("NewWorktreeDialog local file picker", () => {
  it("renders nothing when closed", () => {
    const { container } = renderDialog({ open: false });

    expect(container.textContent).toBe("");
  });

  it("renders as an accessible modal dialog", () => {
    renderDialog({ loadLocalFiles: undefined });

    const dialog = screen.getByRole("dialog", {
      name: "New worktree in project",
    });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
  });

  it("focuses the branch input on open", async () => {
    const { getByPlaceholderText } = renderDialog({
      loadLocalFiles: undefined,
    });

    const branchInput = getByPlaceholderText("feature/foo");
    await waitFor(() => expect(document.activeElement).toBe(branchInput));
  });

  it("loads and renders local file candidates without file contents", async () => {
    const { getByText, queryByText, props } = renderDialog();

    await waitFor(() => expect(getByText(".env")).toBeTruthy());

    expect(props.loadLocalFiles).toHaveBeenCalledWith("p1");
    expect(getByText("9 B")).toBeTruthy();
    expect(queryByText("SECRET=1")).toBeNull();
  });

  it("shows local file loading and load errors", async () => {
    const { rerender, getByText, props } = renderDialog({
      loadLocalFiles: vi.fn(
        () => new Promise<WorktreeLocalFileLoadResult>(() => undefined),
      ),
    });

    expect(getByText("Loading local files…")).toBeTruthy();

    rerender(
      <NewWorktreeDialog
        {...props}
        loadLocalFiles={vi.fn(async () => {
          throw new Error("scan failed");
        })}
      />,
    );

    await waitFor(() => expect(getByText("scan failed")).toBeTruthy());
  });

  it("preselects remembered candidates and submits copy options", async () => {
    const onCreate = vi.fn();
    const { getByLabelText, getByPlaceholderText, getByText } = renderDialog({
      onCreate,
      loadLocalFiles: vi.fn(async () => ({
        candidates: [{ path: ".env", size: 9 }],
        rememberedPaths: [".env"],
      })),
    });

    await waitFor(() => {
      expect((getByLabelText(/\.env/) as HTMLInputElement).checked).toBe(true);
    });

    fireEvent.change(getByPlaceholderText("feature/foo"), {
      target: { value: "feature/env" },
    });
    fireEvent.click(getByText("Create"));

    expect(onCreate).toHaveBeenCalledWith({
      branch: "feature/env",
      base: "",
      copyLocalFiles: [".env"],
      rememberLocalFiles: true,
    });
  });

  it("lets users select a candidate without remembering it", async () => {
    const onCreate = vi.fn();
    const { getByLabelText, getByPlaceholderText, getByText } = renderDialog({
      onCreate,
    });

    await waitFor(() => expect(getByLabelText(/\.env/)).toBeTruthy());

    fireEvent.click(getByLabelText(/\.env/));
    fireEvent.change(getByPlaceholderText("feature/foo"), {
      target: { value: "feature/manual" },
    });
    fireEvent.click(getByText("Create"));

    expect(onCreate).toHaveBeenCalledWith({
      branch: "feature/manual",
      base: "",
      copyLocalFiles: [".env"],
      rememberLocalFiles: false,
    });
  });

  it("disables submit while empty or busy and renders error text", () => {
    const { getByRole, getByText, getByPlaceholderText } = renderDialog({
      busy: true,
      error: "branch exists",
      loadLocalFiles: undefined,
    });

    const submit = getByRole("button", { name: "Creating…" });
    expect(submit).toHaveProperty("disabled", true);
    expect(getByText("branch exists")).toBeTruthy();

    fireEvent.change(getByPlaceholderText("feature/foo"), {
      target: { value: "feature/new" },
    });
    expect(submit).toHaveProperty("disabled", true);
  });

  it("calls onClose from Escape, Cancel, and backdrop", () => {
    const onClose = vi.fn();
    const { container } = renderDialog({
      onClose,
      loadLocalFiles: undefined,
    });

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(container.firstElementChild as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
