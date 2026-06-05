import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { sass } from "@codemirror/lang-sass";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import CodeMirror, { EditorView, type Extension } from "@uiw/react-codemirror";
import { useMemo } from "react";
import { useSettings } from "../../../features/settings/index.js";
import { extname } from "../../../lib/path.js";
import type { TerminalColors } from "../../../lib/theme/types.js";

export const EDITOR_CONTENT_FONT_FAMILY =
  "var(--parasor-content-font, var(--parasor-font, monospace))";

function resolveLanguage(filePath: string): Extension | null {
  const ext = extname(filePath);
  switch (ext) {
    case "ts":
      return javascript({ jsx: false, typescript: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript({ jsx: false, typescript: false });
    case "jsx":
      return javascript({ jsx: true, typescript: false });
    case "json":
    case "jsonc":
      return json();
    case "html":
    case "htm":
      return html();
    case "css":
      return css();
    case "scss":
    case "sass":
    case "less":
      return sass();
    case "md":
    case "mdx":
      return markdown();
    case "py":
      return python();
    case "rs":
      return rust();
    case "go":
      return go();
    case "java":
    case "kt":
      return java();
    case "c":
    case "h":
    case "cc":
    case "cpp":
    case "hpp":
      return cpp();
    case "xml":
      return xml();
    case "yml":
    case "yaml":
      return yaml();
    case "sql":
      return sql();
    case "php":
      return php();
    default:
      return null;
  }
}

function buildEditorTheme(ansi: TerminalColors, dark: boolean): Extension[] {
  const chromeTheme = EditorView.theme(
    {
      "&": {
        backgroundColor: "var(--color-bg-primary)",
        color: "var(--color-text-primary)",
        height: "100%",
      },
      ".cm-scroller": {
        fontFamily: EDITOR_CONTENT_FONT_FAMILY,
      },
      ".cm-content": {
        caretColor: "var(--color-accent)",
        fontFamily: "inherit",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--color-accent)",
      },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
        { backgroundColor: "var(--theme-list-active-bg)" },
      ".cm-selectionMatch": {
        backgroundColor: "var(--theme-list-hover-bg)",
      },
      ".cm-gutters": {
        backgroundColor: "var(--color-bg-primary)",
        color: "var(--color-text-secondary)",
        borderRight: "1px solid var(--color-border)",
        fontFamily: "inherit",
      },
      ".cm-activeLine": { backgroundColor: "var(--theme-list-hover-bg)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--theme-list-hover-bg)" },
      ".cm-matchingBracket": {
        backgroundColor: "var(--theme-list-active-bg)",
        outline: "1px solid var(--color-accent)",
      },
      ".cm-nonmatchingBracket": {
        color: ansi.brightRed,
        outline: `1px solid ${ansi.brightRed}`,
      },
      ".cm-searchMatch": {
        backgroundColor: "var(--theme-list-active-bg)",
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "var(--theme-list-active-bg)",
        color: "var(--color-text-primary)",
        border: "1px solid var(--color-border)",
      },
      ".cm-tooltip": {
        backgroundColor: "var(--color-bg-secondary)",
        color: "var(--color-text-primary)",
        border: "1px solid var(--color-border)",
      },
      ".cm-panels": {
        backgroundColor: "var(--color-bg-secondary)",
        color: "var(--color-text-primary)",
      },
      ".cm-panels-top": { borderBottom: "1px solid var(--color-border)" },
      ".cm-panels-bottom": { borderTop: "1px solid var(--color-border)" },
      ".cm-panel.cm-search": {
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "6px",
        padding: "8px 10px",
        fontSize: "12px",
        fontFamily: "inherit",
      },
      ".cm-panel.cm-search br": { display: "none" },
      ".cm-panel.cm-search label": {
        display: "inline-flex",
        alignItems: "center",
        gap: "4px",
        color: "var(--color-text-secondary)",
        fontSize: "12px",
        cursor: "pointer",
      },
      ".cm-panel.cm-search label input[type=checkbox]": {
        accentColor: "var(--color-accent)",
        margin: 0,
      },
      ".cm-textfield": {
        appearance: "none",
        WebkitAppearance: "none",
        fontFamily: EDITOR_CONTENT_FONT_FAMILY,
        fontSize: "12px",
        padding: "4px 8px",
        borderRadius: "var(--radius-control, 6px)",
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-primary)",
        color: "var(--color-text-primary)",
        outline: "none",
        minWidth: "180px",
      },
      ".cm-textfield:focus": {
        borderColor: "var(--color-accent)",
        boxShadow: "0 0 0 1px var(--color-accent)",
      },
      ".cm-button": {
        appearance: "none",
        WebkitAppearance: "none",
        fontFamily: "inherit",
        fontSize: "12px",
        padding: "4px 10px",
        borderRadius: "var(--radius-control, 6px)",
        border: "1px solid var(--color-border)",
        backgroundColor: "var(--color-bg-primary)",
        backgroundImage: "none",
        color: "var(--color-text-primary)",
        cursor: "pointer",
        textTransform: "none",
      },
      ".cm-button:hover": {
        backgroundColor: "var(--theme-list-hover-bg)",
      },
      ".cm-button:active": {
        backgroundColor: "var(--theme-list-active-bg)",
      },
      ".cm-button:focus-visible": {
        outline: "none",
        borderColor: "var(--color-accent)",
        boxShadow: "0 0 0 1px var(--color-accent)",
      },
      ".cm-panel.cm-search [name=close]": {
        marginLeft: "auto",
        width: "24px",
        height: "24px",
        padding: 0,
        border: "none",
        background: "transparent",
        color: "var(--color-text-secondary)",
        fontSize: "16px",
        lineHeight: "1",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-control, 6px)",
      },
      ".cm-panel.cm-search [name=close]:hover": {
        backgroundColor: "var(--theme-list-hover-bg)",
        color: "var(--color-text-primary)",
      },
    },
    { dark },
  );

  const highlight = HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.self], color: ansi.magenta },
    {
      tag: [t.controlKeyword, t.operatorKeyword],
      color: ansi.brightMagenta,
    },
    {
      tag: [t.name, t.propertyName, t.macroName, t.labelName],
      color: ansi.brightBlue,
    },
    {
      tag: [t.function(t.variableName), t.function(t.propertyName)],
      color: ansi.blue,
    },
    {
      tag: [t.definition(t.variableName), t.definition(t.propertyName)],
      color: "var(--color-text-primary)",
    },
    {
      tag: [t.typeName, t.className, t.namespace],
      color: ansi.cyan,
    },
    { tag: [t.number, t.bool, t.null, t.atom], color: ansi.yellow },
    {
      tag: [t.string, t.special(t.string), t.processingInstruction],
      color: ansi.green,
    },
    {
      tag: [t.regexp, t.escape],
      color: ansi.brightGreen,
    },
    {
      tag: [t.operator, t.punctuation, t.separator, t.bracket],
      color: "var(--color-text-primary)",
    },
    {
      tag: [t.meta, t.comment, t.lineComment, t.blockComment, t.docComment],
      color: "var(--color-text-secondary)",
      fontStyle: "italic",
    },
    {
      tag: [t.url, t.link],
      color: ansi.brightBlue,
      textDecoration: "underline",
    },
    { tag: t.strong, fontWeight: "bold" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    {
      tag: t.heading,
      fontWeight: "bold",
      color: ansi.brightBlue,
    },
    { tag: [t.quote], color: "var(--color-text-secondary)" },
    { tag: t.invalid, color: ansi.brightRed },
    { tag: [t.changed, t.annotation], color: ansi.yellow },
    { tag: [t.inserted], color: ansi.green },
    { tag: [t.deleted], color: ansi.red },
  ]);

  return [chromeTheme, syntaxHighlighting(highlight)];
}

export interface SelectionInfo {
  line: number;
  col: number;
}

interface FileEditorProps {
  value: string;
  filePath: string;
  readOnly: boolean;
  onChange: (next: string) => void;
  onSave?: () => void;
  onSelectionChange?: (info: SelectionInfo) => void;
  /**
   * Captured once the underlying CodeMirror view is mounted. Used by the
   * mobile key bar to dispatch transactions (cursor movement, indent,
   * undo/redo) without re-implementing them at this layer.
   */
  onCreateEditor?: (view: EditorView) => void;
}

export function FileEditor({
  value,
  filePath,
  readOnly,
  onChange,
  onSave,
  onSelectionChange,
  onCreateEditor,
}: FileEditorProps) {
  const { activeTheme } = useSettings();

  const extensions = useMemo<Extension[]>(() => {
    const exts: Extension[] = [
      EditorView.lineWrapping,
      ...buildEditorTheme(activeTheme.terminal, activeTheme.mode === "dark"),
    ];
    const lang = resolveLanguage(filePath);
    if (lang) exts.push(lang);
    if (onSave) {
      exts.push(
        EditorView.domEventHandlers({
          keydown: (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              onSave();
              return true;
            }
            return false;
          },
        }),
      );
    }
    if (onSelectionChange) {
      exts.push(
        EditorView.updateListener.of((update) => {
          if (
            !update.selectionSet &&
            !update.docChanged &&
            !update.viewportChanged
          )
            return;
          const head = update.state.selection.main.head;
          const lineObj = update.state.doc.lineAt(head);
          onSelectionChange({
            line: lineObj.number,
            col: head - lineObj.from + 1,
          });
        }),
      );
    }
    exts.push(
      EditorView.domEventHandlers({
        dragover: (event) => {
          if (!event.dataTransfer?.types.includes("Files")) return false;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          return true;
        },
        drop: (event, view) => {
          const dt = event.dataTransfer;
          if (!dt?.types.includes("Files")) return false;
          const names: string[] = [];
          for (let i = 0; i < dt.items.length; i += 1) {
            const item = dt.items[i];
            const entry =
              typeof item.webkitGetAsEntry === "function"
                ? item.webkitGetAsEntry()
                : null;
            if (entry?.name) {
              names.push(entry.name);
              continue;
            }
            if (item.kind === "file") {
              const file = item.getAsFile();
              if (file?.name) names.push(file.name);
            }
          }
          if (names.length === 0) return false;
          event.preventDefault();
          event.stopPropagation();
          const pos =
            view.posAtCoords({ x: event.clientX, y: event.clientY }) ??
            view.state.selection.main.head;
          const insert = names.join("\n");
          view.dispatch({
            changes: { from: pos, to: pos, insert },
            selection: { anchor: pos + insert.length },
          });
          view.focus();
          return true;
        },
      }),
    );
    return exts;
  }, [
    activeTheme.terminal,
    activeTheme.mode,
    filePath,
    onSave,
    onSelectionChange,
  ]);

  return (
    <CodeMirror
      value={value}
      theme="none"
      extensions={extensions}
      editable={!readOnly}
      readOnly={readOnly}
      onChange={onChange}
      onCreateEditor={onCreateEditor}
      height="100%"
      style={{ height: "100%", fontSize: "var(--parasor-content-font-size)" }}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: !readOnly,
        foldGutter: true,
        bracketMatching: true,
        closeBrackets: !readOnly,
        autocompletion: false,
        highlightSelectionMatches: true,
      }}
    />
  );
}
