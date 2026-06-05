import { describe, expect, it } from "vitest";
import { stripQueryEscapes } from "./scrollback-sanitize.js";

describe("stripQueryEscapes", () => {
  it("strips XTVERSION query (CSI > q)", () => {
    expect(stripQueryEscapes("a\x1b[>qb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[>0qb")).toBe("ab");
  });

  it("strips Device Attributes queries", () => {
    expect(stripQueryEscapes("a\x1b[cb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[0cb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[>cb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[>0cb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[=cb")).toBe("ab");
  });

  it("strips DSR queries", () => {
    expect(stripQueryEscapes("a\x1b[5nb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[6nb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[?15nb")).toBe("ab");
    expect(stripQueryEscapes("a\x1b[?25nb")).toBe("ab");
  });

  it("strips window manipulation queries (11-21)", () => {
    expect(stripQueryEscapes("\x1b[11t")).toBe("");
    expect(stripQueryEscapes("\x1b[14t")).toBe("");
    expect(stripQueryEscapes("\x1b[18t")).toBe("");
    expect(stripQueryEscapes("\x1b[21t")).toBe("");
    expect(stripQueryEscapes("\x1b[13;2t")).toBe("");
  });

  it("keeps window manipulation commands (1-10, 22-23)", () => {
    expect(stripQueryEscapes("\x1b[1t")).toBe("\x1b[1t");
    expect(stripQueryEscapes("\x1b[8;24;80t")).toBe("\x1b[8;24;80t");
    expect(stripQueryEscapes("\x1b[22;0t")).toBe("\x1b[22;0t");
    expect(stripQueryEscapes("\x1b[23;0t")).toBe("\x1b[23;0t");
  });

  it("strips DECRQSS", () => {
    expect(stripQueryEscapes("a\x1bP$qm\x1b\\b")).toBe("ab");
    expect(stripQueryEscapes('a\x1bP$q"p\x1b\\b')).toBe("ab");
  });

  it("strips kitty keyboard queries but keeps restore-cursor", () => {
    expect(stripQueryEscapes("\x1b[?u")).toBe("");
    expect(stripQueryEscapes("\x1b[?1u")).toBe("");
    expect(stripQueryEscapes("\x1b[u")).toBe("\x1b[u");
    expect(stripQueryEscapes("\x1b[>1u")).toBe("\x1b[>1u");
    expect(stripQueryEscapes("\x1b[<1u")).toBe("\x1b[<1u");
  });

  it("strips OSC dynamic color queries", () => {
    expect(stripQueryEscapes("a\x1b]10;?\x07b")).toBe("ab");
    expect(stripQueryEscapes("a\x1b]11;?\x1b\\b")).toBe("ab");
    expect(stripQueryEscapes("a\x1b]12;?\x07b")).toBe("ab");
    expect(stripQueryEscapes("a\x1b]10;?;11;?\x1b\\b")).toBe("ab");
  });

  it("strips OSC palette color queries", () => {
    expect(stripQueryEscapes("a\x1b]4;0;?\x07b")).toBe("ab");
    expect(stripQueryEscapes("a\x1b]4;15;?\x1b\\b")).toBe("ab");
    expect(stripQueryEscapes("a\x1b]4;0;?;255;?\x1b\\b")).toBe("ab");
  });

  it("keeps non-query OSC output", () => {
    expect(stripQueryEscapes("\x1b]7;file://host/repo\x1b\\")).toBe(
      "\x1b]7;file://host/repo\x1b\\",
    );
    expect(
      stripQueryEscapes("\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\"),
    ).toBe("\x1b]8;;https://example.test\x1b\\link\x1b]8;;\x1b\\");
    expect(stripQueryEscapes("\x1b]10;rgb:ffff/eeee/dddd\x1b\\")).toBe(
      "\x1b]10;rgb:ffff/eeee/dddd\x1b\\",
    );
  });

  it("keeps DECSCUSR (CSI Ps q without >)", () => {
    expect(stripQueryEscapes("\x1b[0q")).toBe("\x1b[0q");
    expect(stripQueryEscapes("\x1b[2 q")).toBe("\x1b[2 q");
  });

  it("keeps SGR and cursor sequences", () => {
    expect(stripQueryEscapes("\x1b[0m\x1b[31mred\x1b[0m")).toBe(
      "\x1b[0m\x1b[31mred\x1b[0m",
    );
    expect(stripQueryEscapes("\x1b[2J\x1b[H")).toBe("\x1b[2J\x1b[H");
    expect(stripQueryEscapes("\x1b[?25h\x1b[?25l")).toBe("\x1b[?25h\x1b[?25l");
  });

  it("keeps the auto-resume separator reset modes intact", () => {
    const separator =
      "\x1b[?1;9;1000;1001;1002;1003;1004;1005;1006;1015;1016l" +
      "\x1b[?2004l" +
      "\x1b[?47l\x1b[?1047l\x1b[?1049l" +
      "\x1b[?25h" +
      "\x1b>" +
      "\x1b[>4;0m" +
      "\r\n\x1b[2m─── session restarted 2026-04-20 12:00 ───\x1b[0m\r\n";
    expect(stripQueryEscapes(separator)).toBe(separator);
  });

  it("handles mixed query + output in scrollback-like data", () => {
    const input =
      "prompt$ claude\r\n\x1b[>q\x1b[c\x1b[?25hstreaming output\r\n$ ";
    expect(stripQueryEscapes(input)).toBe(
      "prompt$ claude\r\n\x1b[?25hstreaming output\r\n$ ",
    );
  });

  it("is a no-op for data without escapes", () => {
    expect(stripQueryEscapes("plain text\nnext line\n")).toBe(
      "plain text\nnext line\n",
    );
  });
});
