import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownPreview } from "./MarkdownPreview.js";

afterEach(() => {
  cleanup();
});

describe("MarkdownPreview", () => {
  it("renders headings, paragraphs, and code blocks", () => {
    const md = "# Title\n\nHello **world**\n\n```ts\nconst x = 1;\n```\n";
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const root = getByTestId("markdown-preview");
    expect(root.querySelector("h1")?.textContent).toBe("Title");
    expect(root.querySelector("strong")?.textContent).toBe("world");
    expect(root.querySelector("pre code")?.textContent).toContain(
      "const x = 1;",
    );
  });

  it("renders an empty container when value is empty", () => {
    const { getByTestId } = render(<MarkdownPreview value="" />);
    const root = getByTestId("markdown-preview");
    expect(root.innerHTML.trim()).toBe("");
  });

  it("strips raw <script> tags from input", () => {
    const md = "before\n\n<script>window.__pwn = 1</script>\n\nafter";
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const root = getByTestId("markdown-preview");
    expect(root.querySelector("script")).toBeNull();
    expect(root.innerHTML).not.toContain("window.__pwn");
  });

  it("strips inline event handler attributes", () => {
    const md = '<a href="https://example.com" onclick="alert(1)">link</a>';
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const anchor = getByTestId("markdown-preview").querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor?.hasAttribute("onclick")).toBe(false);
  });

  it("removes javascript: URIs from links", () => {
    const md = "[click](javascript:alert(1))";
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const anchor = getByTestId("markdown-preview").querySelector("a");
    if (anchor) {
      expect(anchor.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
    }
  });

  it("forces target=_blank and rel=noopener noreferrer on links", () => {
    const md = "[home](https://example.com)";
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const anchor = getByTestId("markdown-preview").querySelector("a");
    expect(anchor?.getAttribute("target")).toBe("_blank");
    const rel = anchor?.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
  });

  it("strips iframe tags", () => {
    const md = '<iframe src="https://evil.example"></iframe>';
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    expect(getByTestId("markdown-preview").querySelector("iframe")).toBeNull();
  });

  it("does not let attribute values containing > smuggle in markup (regex bypass)", () => {
    const md =
      '<a href="https://e.com" title="><img src=x onerror=alert(1)>">link</a>';
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const root = getByTestId("markdown-preview");
    const img = root.querySelector("img");
    if (img) {
      expect(img.hasAttribute("onerror")).toBe(false);
    }
  });

  it("overwrites attacker-supplied rel=opener with noopener noreferrer", () => {
    const md = '<a href="https://example.com" rel="opener">x</a>';
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const anchor = getByTestId("markdown-preview").querySelector("a");
    const rel = anchor?.getAttribute("rel") ?? "";
    expect(rel).toContain("noopener");
    expect(rel).toContain("noreferrer");
    expect(rel).not.toContain('opener"');
  });

  it("strips svg and math tags", () => {
    const md =
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg><math><mtext>x</mtext></math>';
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const root = getByTestId("markdown-preview");
    expect(root.querySelector("svg")).toBeNull();
    expect(root.querySelector("math")).toBeNull();
  });

  it("does not let foreignObject smuggle children out of an svg shell", () => {
    const md =
      '<svg><foreignObject><a href="javascript:alert(1)"><img src=x onerror=alert(2)></a></foreignObject></svg>';
    const { getByTestId } = render(<MarkdownPreview value={md} />);
    const root = getByTestId("markdown-preview");
    expect(root.querySelector("svg")).toBeNull();
    expect(root.querySelector("foreignObject")).toBeNull();
    // The svg/foreignObject children themselves must drop -- it's not
    // enough that <img> sheds onerror. The namespace-confusion regression
    // we guard against let <a>/<img> exfiltrate as plain HTML.
    expect(root.querySelector("a")).toBeNull();
    expect(root.querySelector("img")).toBeNull();
  });
});
