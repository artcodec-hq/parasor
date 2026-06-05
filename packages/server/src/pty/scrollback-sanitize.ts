/*
 * Terminal query escape sequences that solicit a response from xterm.js
 * back to the host. xterm sends the response via its `onData` hook, which
 * we forward straight to the PTY stdin. During live operation the shell
 * is usually mid-command and discards the response silently.
 *
 * On re-attach, the server replays accumulated scrollback to the new
 * client's xterm. Any query escape inside that history gets re-parsed,
 * xterm emits the response again, it lands in the shell's readline
 * buffer this time -- because the shell is now idle at a prompt -- and
 * the user sees garbage like `>|xterm.js(6.1.0-beta.197)1;2c` appear
 * on their command line.
 *
 * Strip the known query sequences from replayed scrollback so xterm
 * has nothing to respond to. Live output is left untouched (single
 * legitimate response per query is the protocol).
 *
 * Stripped patterns:
 *   CSI [priv]? [params] c      Device Attributes (DA1/DA2/DA3). The
 *                               final byte 'c' is exclusively DA in
 *                               standard terminals.
 *   CSI [?]?   [params] n       Device Status Report family (CSI 5n,
 *                               6n, ?15n, ?25n, ?26n, ?55n, ?56n, ?62n,
 *                               ?63n). Final 'n' is DSR-only.
 *   CSI >      [params] q       XTVERSION query. DECSCUSR uses 'q' too
 *                               but without the '>' prefix -- kept.
 *   CSI (11-21) [;params]? t    Window manipulation queries. 1-10 are
 *                               commands (iconify/resize/etc.), 22-23
 *                               are stack ops -- kept.
 *   CSI ?      [params] u       Kitty keyboard protocol query. Plain
 *                               'CSI u' (restore cursor) and 'CSI >/<'
 *                               variants (push/pop state) -- kept.
 *   OSC 10-19 ; ? [; 10-19 ; ?]*
 *              ST/BEL           Dynamic color queries (foreground,
 *                               background, cursor, etc.).
 *   OSC 4 ; idx ; ? ST/BEL      Palette color queries.
 *   DCS $ q ... ST              DECRQSS (request selection or setting).
 */
const OSC_TERMINATOR_RE = String.raw`(?:\x07|\x1b\\)`;
const OSC_DYNAMIC_COLOR_QUERY_RE = String.raw`(?:1[0-9];\?)(?:;1[0-9];\?)*`;
const OSC_PALETTE_COLOR_QUERY_RE = String.raw`4;[0-9]{1,3};\?(?:;[0-9]{1,3};\?)*`;

const QUERY_ESCAPE_RE = new RegExp(
  [
    String.raw`\x1b\[[?=>]?[0-9;]*c`,
    String.raw`\x1b\[\??[0-9;]*n`,
    String.raw`\x1b\[>[0-9;]*q`,
    String.raw`\x1b\[(?:1[1-9]|2[01])(?:;[0-9]+)*t`,
    String.raw`\x1b\[\?[0-9;]*u`,
    String.raw`\x1b\](?:${OSC_DYNAMIC_COLOR_QUERY_RE}|${OSC_PALETTE_COLOR_QUERY_RE})${OSC_TERMINATOR_RE}`,
    String.raw`\x1bP\$q[\s\S]*?\x1b\\`,
  ].join("|"),
  "g",
);

export function stripQueryEscapes(data: string): string {
  return data.replace(QUERY_ESCAPE_RE, "");
}
