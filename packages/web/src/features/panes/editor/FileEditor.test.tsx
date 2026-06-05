import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsProvider } from "../../settings/SettingsProvider.js";
import { EDITOR_CONTENT_FONT_FAMILY, FileEditor } from "./FileEditor.js";

afterEach(() => {
  cleanup();
});

describe("FileEditor theme", () => {
  it("applies the content font to the editor text surface and gutters", () => {
    render(
      <SettingsProvider>
        <FileEditor
          value={"const value = 1;\n"}
          filePath="src/example.ts"
          readOnly={false}
          onChange={() => {}}
        />
      </SettingsProvider>,
    );

    const styleText = Array.from(document.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .join("\n");

    expect(styleText).toContain(".cm-scroller");
    expect(styleText).toContain(`font-family: ${EDITOR_CONTENT_FONT_FAMILY}`);
    expect(styleText).toContain(".cm-gutters");
    expect(styleText).toContain("font-family: inherit");
  });
});
