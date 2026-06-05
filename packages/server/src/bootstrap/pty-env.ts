import { join } from "node:path";
import type { ShimPaths } from "../cli/shim-installer.js";

export function buildStaticPtyEnv(
  shims: ShimPaths,
  configDir: string,
): Record<string, string> {
  return {
    PARASOR_BASH_RC: shims.bashRcPath,
    PARASOR_SOCKET: join(configDir, "parasor.sock"),
    ...(shims.realOpen ? { PARASOR_REAL_OPEN: shims.realOpen } : {}),
    ...(shims.realXdgOpen ? { PARASOR_REAL_XDG_OPEN: shims.realXdgOpen } : {}),
    PATH: `${shims.binDir}:${process.env.PATH ?? ""}`,
    ZDOTDIR: shims.zshDotdir,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    TERM_PROGRAM: "parasor",
  };
}
