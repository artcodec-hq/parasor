import DOMPurify, { type Config as DOMPurifyConfig } from "dompurify";
import { Marked } from "marked";
import { useMemo } from "react";

interface MarkdownPreviewProps {
  value: string;
}

const SANITIZE_CONFIG: DOMPurifyConfig = {
  USE_PROFILES: { html: true },
  ADD_ATTR: ["target", "rel"],
  FORBID_TAGS: ["style", "iframe", "object", "embed", "form", "svg", "math"],
  FORBID_ATTR: ["style", "srcset", "formaction"],
  // Don't override FORBID_CONTENTS -- DOMPurify's default drops the
  // contents of script/style/svg/math/foreignObject/annotation-xml so
  // namespace-confused children can't leak. A custom list silently
  // shrinks that protection.
};

// Dedicated Marked instance so an unrelated import setting `async: true` on
// the global singleton can't make our parse() return a Promise instead of a
// string.
const md = new Marked({ async: false, gfm: true, breaks: false });

// `addHook` pushes onto an internal array, so registering on every module
// re-import (HMR, Vitest module cache reset) would compound the same hook
// on every render. Guard with a global symbol so registration is
// idempotent.
const LINK_HOOK_REGISTERED = Symbol.for(
  "@parasor/web.MarkdownPreview.linkHook",
);
type HookFlagWindow = typeof globalThis & { [LINK_HOOK_REGISTERED]?: true };
if (!(globalThis as HookFlagWindow)[LINK_HOOK_REGISTERED]) {
  // `afterSanitizeAttributes` runs on every element after attribute
  // filtering. Operating on the parsed DOM (not the serialized HTML)
  // avoids the regex pitfall where attribute values containing `>` or
  // `target="..."` confuse a string scan and let attacker-controlled
  // markup slip back in.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName !== "A") return;
    const el = node as HTMLAnchorElement;
    el.setAttribute("target", "_blank");
    // Always overwrite rel so an existing value like `rel="opener"` cannot
    // weaken the noopener guarantee.
    el.setAttribute("rel", "noopener noreferrer");
  });
  (globalThis as HookFlagWindow)[LINK_HOOK_REGISTERED] = true;
}

function renderMarkdown(source: string): string {
  const raw = md.parse(source) as string;
  // No RETURN_DOM* / RETURN_TRUSTED_TYPE flags ⇒ sanitize returns string.
  return DOMPurify.sanitize(raw, SANITIZE_CONFIG) as string;
}

export function MarkdownPreview({ value }: MarkdownPreviewProps) {
  const html = useMemo(() => renderMarkdown(value), [value]);

  return (
    <div
      data-testid="markdown-preview"
      className="markdown-preview h-full overflow-auto bg-bg-primary px-6 py-4 text-sm text-text-primary"
      /* biome-ignore lint/security/noDangerouslySetInnerHtml: renderMarkdown sanitizes with DOMPurify before injection. */
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
