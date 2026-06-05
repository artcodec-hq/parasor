export interface ColorThemeJson {
  name: string;
  type?: "dark" | "light" | "hc" | "hcLight";
  colors: Record<string, string>;
}

export type ThemeMode = "dark" | "light";

export type WorkbenchTokens = Record<string, string>;

export interface TerminalColors {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface ThemeEntry {
  id: string;
  name: string;
  mode: ThemeMode;
  source: "builtin" | "custom";
  tokens: WorkbenchTokens;
  terminal: TerminalColors;
}
