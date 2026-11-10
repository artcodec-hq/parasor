import type { Project, Session } from "@parasor/shared";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  computeMonitorColumnLayout,
  computeMonitorVisibleRange,
  MonitorView,
} from "./MonitorView.js";

vi.mock("../panes/terminal/TerminalPane.js", () => ({
  TerminalPane: () => null,
}));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p1",
    name: "p1",
    path: "/repos/p1",
    createdAt: 0,
    lastAccessedAt: 0,
    ...overrides,
  };
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    projectId: "p1",
    pid: 1234,
    state: "running",
    generation: 0,
    title: "",
    command: { type: "shell" },
    cwd: "/repos/p1",
    shell: "/bin/zsh",
    createdAt: 0,
    pinned: true,
    ...overrides,
  };
}

describe("computeMonitorColumnLayout", () => {
  it("uses one full-width column below the readable agent width", () => {
    expect(computeMonitorColumnLayout(360, 3)).toEqual({
      visibleColumns: 1,
      columnWidth: 360,
    });
  });

  it("fills the viewport with the maximum readable column count", () => {
    expect(computeMonitorColumnLayout(1280, 5)).toEqual({
      visibleColumns: 3,
      columnWidth: 426,
    });
    expect(computeMonitorColumnLayout(1680, 5)).toEqual({
      visibleColumns: 4,
      columnWidth: 420,
    });
  });

  it("stretches sparse pinned terminals across the viewport", () => {
    expect(computeMonitorColumnLayout(1680, 2)).toEqual({
      visibleColumns: 2,
      columnWidth: 840,
    });
  });
});

describe("MonitorView", () => {
  const baseProps = {
    projects: [project()],
    sessions: [
      session({ id: "s1", createdAt: 1 }),
      session({ id: "s2", createdAt: 2, cwd: "/repos/p1/feature" }),
    ],
    agentStates: {},
    reviewPendingSessions: new Set<string>(),
    isMobile: false,
    onRestartSession: vi.fn(),
    onOpenUrl: vi.fn(),
    onTogglePin: vi.fn(),
  };

  it("renders desktop pinned columns without visible-range prop errors", () => {
    const { getByLabelText, getByText } = render(
      createElement(MonitorView, baseProps),
    );

    expect(getByText("Monitor")).not.toBeNull();
    expect(getByLabelText("Go to pinned terminal 1")).not.toBeNull();
  });

  it("renders mobile pager without desktop visible-range callbacks", () => {
    const { getByLabelText, getByText } = render(
      createElement(MonitorView, { ...baseProps, isMobile: true }),
    );

    expect(getByText("Monitor")).not.toBeNull();
    expect(getByLabelText("Go to pinned terminal 1")).not.toBeNull();
  });
});

describe("computeMonitorVisibleRange", () => {
  it("reports the visible pane indexes for the current horizontal viewport", () => {
    expect(computeMonitorVisibleRange(0, 1280, 426, 5)).toEqual({
      start: 0,
      end: 2,
    });
    expect(computeMonitorVisibleRange(426, 1280, 426, 5)).toEqual({
      start: 1,
      end: 3,
    });
    expect(computeMonitorVisibleRange(852, 1280, 426, 5)).toEqual({
      start: 2,
      end: 4,
    });
  });

  it("keeps the visible range within the available panes", () => {
    expect(computeMonitorVisibleRange(900, 1280, 426, 3)).toEqual({
      start: 2,
      end: 2,
    });
    expect(computeMonitorVisibleRange(0, 0, 426, 3)).toEqual({
      start: 0,
      end: 0,
    });
  });
});
