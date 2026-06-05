import { normalizeIdeCommands } from "@parasor/shared";
import { describe, expect, it } from "vitest";

describe("normalizeIdeCommands", () => {
  it("keeps valid custom IDE commands", () => {
    expect(
      normalizeIdeCommands([
        {
          id: "zed",
          label: " Zed ",
          command: " zed ",
          args: [" {path} "],
        },
      ]),
    ).toEqual([{ id: "zed", label: "Zed", command: "zed", args: ["{path}"] }]);
  });

  it("rejects reserved and malformed commands", () => {
    expect(
      normalizeIdeCommands([
        { id: "cursor", label: "Cursor", command: "cursor", args: ["{path}"] },
        { id: "bad", label: "", command: "bad", args: [] },
        { id: "ok", label: "OK", command: "ok", args: "nope" },
      ]),
    ).toEqual([]);
  });
});
