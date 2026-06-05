import { describe, expect, it } from "vitest";
import {
  paneCommandsWithBuiltins,
  parsePaneCommandStore,
} from "./pane-command-store.js";

describe("pane-command-store", () => {
  it("returns an empty custom command list for invalid storage", () => {
    expect(parsePaneCommandStore(null)).toEqual([]);
    expect(parsePaneCommandStore("not-json")).toEqual([]);
    expect(parsePaneCommandStore("{}")).toEqual([]);
  });

  it("preserves valid custom commands", () => {
    const raw = JSON.stringify([
      { id: "cmd:1", label: " Dev ", initialInput: " pnpm dev " },
    ]);
    expect(parsePaneCommandStore(raw)).toEqual([
      { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
    ]);
  });

  it("drops malformed, duplicate, builtin, and empty commands", () => {
    const raw = JSON.stringify([
      { id: "builtin:terminal", label: "x", initialInput: "x" },
      { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
      { id: "cmd:1", label: "Duplicate", initialInput: "echo duplicate" },
      { id: "cmd:2", label: "", initialInput: "echo no-label" },
      { id: "cmd:3", label: "No command", initialInput: "" },
      { id: 4, label: "Bad", initialInput: "echo bad" },
    ]);
    expect(parsePaneCommandStore(raw)).toEqual([
      { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
    ]);
  });

  it("prepends the immutable Terminal command", () => {
    expect(
      paneCommandsWithBuiltins([
        { id: "cmd:1", label: "Dev", initialInput: "pnpm dev" },
      ]),
    ).toEqual([
      {
        id: "builtin:terminal",
        label: "Terminal",
        initialInput: "",
        builtin: true,
      },
      {
        id: "cmd:1",
        label: "Dev",
        initialInput: "pnpm dev",
        builtin: false,
      },
    ]);
  });
});
