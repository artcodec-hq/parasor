import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import { createTerminalFileLinkProvider } from "./terminal-file-links.js";

type TerminalOptions = NonNullable<ConstructorParameters<typeof XTerm>[0]>;

export function createTerminalInstance({
  fontFamily,
  fontSize,
  theme,
  isEnded,
  unicodeVersion,
  openUrl,
  getWorktreePath,
  openFilePath,
}: {
  fontFamily: string;
  fontSize: number;
  theme: TerminalOptions["theme"];
  isEnded: boolean;
  unicodeVersion: string;
  openUrl: (uri: string) => void;
  getWorktreePath: () => string | undefined;
  openFilePath: (filePath: string) => void;
}) {
  const term = new XTerm({
    fontFamily,
    fontSize,
    disableStdin: isEnded,
    theme,
    allowProposedApi: true,
    cursorStyle: "block",
    cursorBlink: !isEnded,
    // xterm's default is 1000. Keep a generous window so a multi-screen
    // build log stays scrollable, but avoid 50k-line buffers per pane --
    // they balloon heap on long-running tabs with multiple terminals.
    scrollback: 10000,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  /*
   * Unicode 11 wcwidth addon. The stock xterm wcwidth table predates
   * Unicode 11's widening of many East Asian / emoji codepoints to
   * wide (2-cell). Without this, mixed CJK/emoji lines drift a cell
   * per occurrence and box-drawing/TUIs misalign on CJK locales.
   */
  term.loadAddon(new Unicode11Addon());
  term.unicode.activeVersion = unicodeVersion;
  term.loadAddon(new WebLinksAddon((_event, uri) => openUrl(uri)));
  const fileLinkProviderDisposable = term.registerLinkProvider(
    createTerminalFileLinkProvider(
      (bufferLineNumber) => term.buffer.active.getLine(bufferLineNumber - 1),
      getWorktreePath,
      openFilePath,
    ),
  );

  return {
    term,
    fitAddon,
    fileLinkProviderDisposable,
  };
}
