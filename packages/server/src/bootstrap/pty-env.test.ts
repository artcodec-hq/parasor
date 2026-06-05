import { describe, expect, it } from "vitest";
import type { ShimPaths } from "../cli/shim-installer.js";
import { buildStaticPtyEnv } from "./pty-env.js";

describe("buildStaticPtyEnv", () => {
  it("includes shim paths and truecolor terminal capabilities", () => {
    const shims: ShimPaths = {
      bashRcPath: "/cfg/shell/bash/.bashrc",
      binDir: "/cfg/bin",
      realOpen: "/usr/bin/open",
      realXdgOpen: null,
      zshDotdir: "/cfg/shell/zsh",
    };

    const env = buildStaticPtyEnv(shims, "/cfg");

    expect(env.PARASOR_BASH_RC).toBe("/cfg/shell/bash/.bashrc");
    expect(env.PARASOR_SOCKET).toBe("/cfg/parasor.sock");
    expect(env.PARASOR_REAL_OPEN).toBe("/usr/bin/open");
    expect(env.PARASOR_REAL_XDG_OPEN).toBeUndefined();
    expect(env.PATH).toMatch(/^\/cfg\/bin:/);
    expect(env.ZDOTDIR).toBe("/cfg/shell/zsh");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
    expect(env.TERM_PROGRAM).toBe("parasor");
  });
});
