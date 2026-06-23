import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NewProjectDialog } from "./NewProjectDialog.js";

interface MockResponse {
  match: (input: RequestInfo | URL, init?: RequestInit) => boolean;
  status: number;
  body: unknown;
}

let mockResponses: MockResponse[] = [];
const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  for (const response of mockResponses) {
    if (response.match(input, init)) {
      return new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }
  }
  throw new Error(`unmocked fetch: ${String(input)}`);
});

beforeEach(() => {
  mockResponses = [];
  fetchSpy.mockClear();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
});

function mockBrowse(path: string, parent: string | null = null) {
  mockResponses.push({
    match: (input) => {
      const url = String(input);
      return url.startsWith("/api/fs/browse");
    },
    status: 200,
    body: { path, parent, entries: [] },
  });
}

async function openDialogWithBrowse(path: string) {
  mockBrowse(path);
  const onCreate = vi.fn();
  const result = render(
    <NewProjectDialog open={true} onClose={vi.fn()} onCreate={onCreate} />,
  );
  await waitFor(() => {
    expect(fetchSpy).toHaveBeenCalled();
  });
  return { ...result, onCreate };
}

async function openCreateFolderForm(container: HTMLElement) {
  const trigger = Array.from(container.querySelectorAll("button")).find((b) =>
    b.textContent?.includes("New folder here"),
  ) as HTMLButtonElement;
  fireEvent.click(trigger);
  await waitFor(() => {
    expect(
      container.querySelector("input[placeholder='my-new-app']"),
    ).toBeTruthy();
  });
}

describe("NewProjectDialog -- create new folder", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <NewProjectDialog open={false} onClose={vi.fn()} onCreate={vi.fn()} />,
    );
    expect(container.textContent).toBe("");
  });

  it("renders as an accessible dialog", async () => {
    mockBrowse("/Users/test/projects");
    render(
      <NewProjectDialog open={true} onClose={vi.fn()} onCreate={vi.fn()} />,
    );

    const dialog = screen.getByRole("dialog", { name: "New project" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
  });

  it("calls onClose from Escape, Cancel, and backdrop", async () => {
    mockBrowse("/Users/test/projects");
    const onClose = vi.fn();
    const { container } = render(
      <NewProjectDialog open={true} onClose={onClose} onCreate={vi.fn()} />,
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(container.firstElementChild as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it("uses the same project folder form on mobile", () => {
    mockBrowse("/Users/test/projects");
    render(
      <NewProjectDialog
        open={true}
        onClose={vi.fn()}
        onCreate={vi.fn()}
        isMobile={true}
      />,
    );

    expect(screen.getByLabelText("Project folder")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Choose folder" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    const dialog = screen.getByRole("dialog", { name: "New project" });
    expect(dialog.className).toContain("h-full");
    expect(document.body.querySelector(".rounded-t-xl")).toBeNull();
  });

  it("shows the loaded folder as the project folder value", async () => {
    await openDialogWithBrowse("/Users/test/projects");
    await waitFor(() => {
      expect(
        (screen.getByLabelText("Project folder") as HTMLInputElement).value,
      ).toBe("/Users/test/projects");
    });
  });

  it("shows the create-new-folder affordance once a parent folder is loaded", async () => {
    const { container } = await openDialogWithBrowse("/Users/test/projects");
    await waitFor(() => {
      expect(container.textContent).toContain("New folder here");
    });
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.includes("New folder here"),
    );
    expect(createBtn).toBeTruthy();
    expect((createBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables the submit button while the name is empty", async () => {
    const { container } = await openDialogWithBrowse("/Users/test/projects");
    await openCreateFolderForm(container);
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Create",
    ) as HTMLButtonElement;
    expect(createBtn).toBeTruthy();
    expect(createBtn.disabled).toBe(true);
  });

  it("disables the submit button when the name contains a slash", async () => {
    const { container } = await openDialogWithBrowse("/Users/test/projects");
    await openCreateFolderForm(container);
    const input = container.querySelector(
      "input[placeholder='my-new-app']",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a/b" } });
    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Create",
    ) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);
  });

  it("posts to /api/fs/mkdir with the parent + trimmed name and registers the new project", async () => {
    const { container, onCreate } = await openDialogWithBrowse(
      "/Users/test/projects",
    );

    mockResponses.push({
      match: (_, init) => init?.method === "POST",
      status: 201,
      body: { path: "/Users/test/projects/new-app" },
    });

    await openCreateFolderForm(container);

    const input = container.querySelector(
      "input[placeholder='my-new-app']",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  new-app  " } });

    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Create",
    ) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledWith(
        "/Users/test/projects/new-app",
        "new-app",
      );
    });

    const mkdirCall = fetchSpy.mock.calls.find(
      ([, init]) => init?.method === "POST",
    );
    expect(mkdirCall).toBeTruthy();
    const [, mkdirInit] = mkdirCall as [unknown, RequestInit];
    expect(JSON.parse(mkdirInit.body as string)).toEqual({
      parent: "/Users/test/projects",
      name: "new-app",
    });
  });

  it("surfaces server error messages without closing the form", async () => {
    const { container, onCreate } = await openDialogWithBrowse(
      "/Users/test/projects",
    );

    mockResponses.push({
      match: (_, init) => init?.method === "POST",
      status: 409,
      body: { error: "Directory already exists" },
    });

    await openCreateFolderForm(container);
    const input = container.querySelector(
      "input[placeholder='my-new-app']",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "parasor" } });

    const createBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Create",
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(createBtn);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Directory already exists");
    });
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("cancel closes the inline form without creating", async () => {
    const { container, onCreate } = await openDialogWithBrowse(
      "/Users/test/projects",
    );
    const trigger = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("New folder here"),
    ) as HTMLButtonElement;
    fireEvent.click(trigger);
    const input = container.querySelector(
      "input[placeholder='my-new-app']",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "x" } });

    const cancelBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Cancel" && b.previousSibling === null,
    ) as HTMLButtonElement | undefined;
    // Pick the inner Cancel via its position relative to Create
    const innerCancel = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent === "Cancel",
    )[0] as HTMLButtonElement;
    fireEvent.click(innerCancel);
    expect(cancelBtn ?? innerCancel).toBeTruthy();

    await waitFor(() => {
      expect(container.textContent).toContain("New folder here");
    });
    expect(onCreate).not.toHaveBeenCalled();
  });
});
