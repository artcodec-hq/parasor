import { homedir } from "node:os";
import { join } from "node:path";

export function expandUserHome(
  rawPath: string,
  home: string = homedir(),
): string {
  if (rawPath === "~") return home;
  if (rawPath.startsWith("~/")) return join(home, rawPath.slice(2));
  return rawPath;
}
