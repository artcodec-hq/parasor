#!/usr/bin/env node
/*
 * Local install / uninstall driver for the published `parasor` tree.
 * Wraps `pnpm package` (which assembles `dist/`) with a pack-then-
 * install-tarball sequence so the user's PATH gets a `parasor` command
 * without going through npm publish.
 *
 * Usage:
 *   pnpm install:local      -> build + install globally (idempotent;
 *                             re-run after source changes to refresh
 *                             the globally-installed CLI)
 *   pnpm uninstall:local    -> service uninstall + npm uninstall + remove dist/
 *
 * Why pack + `npm install -g <tarball>` instead of `npm link` or
 * `npm install -g <distDir>`:
 *   - `npm link` symlinks `<prefix>/lib/node_modules/parasor` -> repo
 *     `dist/`. Deleting `dist/` leaves a dangling install, and the
 *     chain breaks whenever the npm subject (proto/mise/nvm/brew)
 *     changes because the new prefix has no symlink.
 *   - `npm install -g <folder>` is, per current npm semantics, also a
 *     symlink install (effectively the same as `npm link`).
 *   - `npm install -g <tarball>` is the only path that triggers npm's
 *     publish-style install: it extracts the tarball into
 *     `<prefix>/lib/node_modules/parasor/` as a real directory and
 *     resolves runtime `dependencies` from the registry -- exactly the
 *     code path `npm install -g @biomejs/biome` takes. That is why
 *     published CLIs survive every subject swap with nothing more
 *     than a reinstall.
 */

import { spawnSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distDir = resolve(repoRoot, "dist");

const args = new Set(process.argv.slice(2));
const uninstall = args.has("--uninstall");

function log(msg) {
  process.stdout.write(`[install:local] ${msg}\n`);
}

function resolveCommand(name) {
  const res = spawnSync("sh", ["-lc", `command -v ${name}`], {
    encoding: "utf8",
  });
  return res.status === 0 ? res.stdout.trim().split("\n")[0] : "";
}

function prefixFromBin(binPath) {
  if (!binPath.endsWith("/bin/parasor")) return null;
  return dirname(dirname(binPath));
}

function protoGlobalsPrefix() {
  const protoHome = process.env.PROTO_HOME ?? join(homedir(), ".proto");
  const prefix = join(protoHome, "tools/node/globals");
  return existsSync(join(prefix, "bin")) ? prefix : null;
}

function canWriteOrCreate(path) {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
  try {
    accessSync(current, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function verifyInstallPrefix(npmPrefix) {
  const resolved = resolve(npmPrefix);
  // npm install -g writes to `${prefix}/lib/node_modules/<pkg>` and links into
  // `${prefix}/bin`. Check those actual write targets, not just the prefix root --
  // a chown-mismatched prefix can have a writable root but unwritable subdirs.
  const writeTargets = [
    resolved,
    join(resolved, "bin"),
    join(resolved, "lib", "node_modules"),
  ];
  if (writeTargets.every(canWriteOrCreate)) return resolved;

  const userPrefix = join(homedir(), ".local");
  throw new Error(
    [
      `global install prefix ${resolved} is not writable by this user.`,
      `install:local checked the prefix root and its bin/ + lib/node_modules/ subdirs; at least one is unwritable.`,
      `Set npm's global prefix or PARASOR_INSTALL_PREFIX to a writable prefix whose bin directory is on PATH.`,
      `For example: mkdir -p ${join(userPrefix, "bin")} && export PATH="${join(userPrefix, "bin")}:$PATH"`,
      `Then run: PARASOR_INSTALL_PREFIX=${userPrefix} pnpm install:local`,
    ].join("\n"),
  );
}

function resolveInstallPrefix() {
  const explicit = process.env.PARASOR_INSTALL_PREFIX;
  if (explicit) return verifyInstallPrefix(explicit);

  /*
   * proto exposes user-facing globals from ~/.proto/tools/node/globals/bin,
   * but npm invoked from a versioned Node can default to
   * ~/.proto/tools/node/<version>. Pin the prefix to globals when that is the
   * parasor command users and launchd already run.
   */
  const protoGlobals = protoGlobalsPrefix();
  if (protoGlobals && existsSync(join(protoGlobals, "bin/parasor"))) {
    return verifyInstallPrefix(protoGlobals);
  }

  const parasorPath = resolveCommand("parasor");
  const fromParasor = parasorPath ? prefixFromBin(parasorPath) : null;
  if (fromParasor) return verifyInstallPrefix(fromParasor);

  const npmPrefix =
    process.env.NPM_CONFIG_PREFIX ?? process.env.npm_config_prefix;
  if (npmPrefix) return verifyInstallPrefix(npmPrefix);

  const prefixRes = spawnSync("npm", ["config", "get", "prefix"], {
    encoding: "utf8",
  });
  if (prefixRes.status === 0 && prefixRes.stdout.trim()) {
    return verifyInstallPrefix(prefixRes.stdout.trim());
  }
  throw new Error(
    "unable to resolve global install prefix; set PARASOR_INSTALL_PREFIX",
  );
}

// pnpm prepends `<workspace>/node_modules/.bin` and the active node's
// per-version `bin/` to PATH when running scripts. Use the npm that belongs to
// the current Node runtime, but force the install prefix separately below so
// npm cannot silently install into a per-version prefix that PATH/launchd never
// use.
function resolveNpm() {
  const candidates = [
    join(dirname(process.execPath), "npm"),
    process.env.MISE_DATA_DIR
      ? join(process.env.MISE_DATA_DIR, "shims/npm")
      : null,
    join(homedir(), ".local/share/mise/shims/npm"),
    process.env.PROTO_HOME ? join(process.env.PROTO_HOME, "shims/npm") : null,
    join(homedir(), ".proto/shims/npm"),
  ].filter(Boolean);
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "npm";
}

const npmCmd = resolveNpm();
const installPrefix = resolveInstallPrefix();
const npmEnv = {
  ...process.env,
  npm_config_prefix: installPrefix,
  NPM_CONFIG_PREFIX: installPrefix,
};
log(`using npm: ${npmCmd}`);
log(`install prefix: ${installPrefix}`);

function run(cmd, cmdArgs, cwd, env = process.env) {
  log(`${cmd} ${cmdArgs.join(" ")} (cwd=${cwd})`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd, env });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} exited with ${res.status}`);
  }
}

function tryRun(cmd, cmdArgs, cwd, env = process.env) {
  log(`${cmd} ${cmdArgs.join(" ")} (cwd=${cwd}) [best-effort]`);
  const res = spawnSync(cmd, cmdArgs, { stdio: "inherit", cwd, env });
  if (res.status !== 0) {
    log(`  exited with ${res.status} (continuing)`);
    return false;
  }
  return true;
}

function reportLegacyResidue() {
  // npm-link era leftovers: `npm link` placed a symlink at
  // <per-version-prefix>/lib/node_modules/parasor -> repo dist/, plus a
  // matching bin/ symlink. The new install path uses `npm install -g
  // <tarball>` into <globals>/lib/node_modules/parasor (a real copy), so
  // these per-version symlinks are pure residue. They still cause
  // breakage because `pnpm exec` prepends the active node's per-version
  // bin to PATH -- `pnpm exec parasor` resolves the stale symlink and
  // dies importing node-pty out of the now-stripped repo dist/. We only
  // hint; rm-ing inside per-version dirs is user-owned territory.
  const npmLinkResidue = [];
  const versionRoots = [
    join(homedir(), ".proto/tools/node"),
    join(homedir(), ".local/share/mise/installs/node"),
    join(homedir(), ".nvm/versions/node"),
  ].filter((p) => existsSync(p));
  for (const root of versionRoots) {
    let versions;
    try {
      versions = readdirSync(root);
    } catch {
      continue;
    }
    for (const ver of versions) {
      if (ver === "globals") continue; // globals/ is the legitimate install target
      // proto/mise drop manifest.json / remote-versions.json into the
      // tools-root alongside per-version dirs. Skip non-directory entries.
      try {
        if (!lstatSync(join(root, ver)).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const tail of ["lib/node_modules/parasor", "bin/parasor"]) {
        const p = join(root, ver, tail);
        try {
          if (lstatSync(p).isSymbolicLink()) npmLinkResidue.push(p);
        } catch (err) {
          // ENOENT = path simply not present (the common case). Anything
          // else (EACCES, ELOOP, ENOTDIR) means the path exists but we
          // cannot inspect it -- surface so the user knows residue may
          // still be hiding there.
          if (err && err.code !== "ENOENT") {
            log(`  warning: cannot stat ${p}: ${err.code || err.message}`);
          }
        }
      }
    }
  }

  if (npmLinkResidue.length === 0) return;
  log("");
  log("Detected legacy npm-link residue (pre-tarball install path):");
  log("  These symlinks shadow the global install in `pnpm exec` context.");
  for (const p of npmLinkResidue) log(`  rm ${p}`);
}

if (uninstall) {
  // 1. Tear down LaunchAgents while the binary is still reachable.
  //    Prefer the global `parasor` command (resolves via PATH); if
  //    that fails (e.g. the global install was already removed by
  //    hand) fall back to running dist/bin/parasor.mjs directly.
  const distBin = join(distDir, "bin/parasor.mjs");
  if (!tryRun("parasor", ["service", "uninstall"], repoRoot)) {
    if (existsSync(distBin)) {
      tryRun("node", [distBin, "service", "uninstall"], distDir);
    }
  }
  // 2. Remove the global install. `parasor` is the actual installed
  //    name (see scripts/package.mjs `publishPkg.name`).
  try {
    run(npmCmd, ["uninstall", "-g", "parasor"], repoRoot, npmEnv);
  } catch (err) {
    log(`npm uninstall -g failed (continuing): ${err.message}`);
  }
  if (existsSync(distDir)) {
    log(`removing ${distDir}`);
    rmSync(distDir, { recursive: true, force: true });
  }
  reportLegacyResidue();
  log("done");
  process.exit(0);
}

run("pnpm", ["package"], repoRoot);

if (!existsSync(distDir)) {
  throw new Error(`pnpm package did not produce ${distDir}`);
}

// Pack dist/ into a tarball, then install the tarball globally.
// `npm install -g <folder>` symlinks the folder (same as `npm link`),
// so we have to go through pack to get a publish-equivalent copy
// install that survives subject swaps without depending on dist/.
//
// Both commands run with cwd=distDir, never repoRoot, for two reasons:
//   1. proto resolves the node version from the nearest package.json
//      with an `engines.node` field. dist/package.json supplies that;
//      a cwd outside the workspace (e.g. /tmp) leaves proto unable to
//      pick a node and the spawn fails with `proto::detect::failed`.
//   2. From repoRoot, npm sees the pnpm workspace and tries to
//      substitute the bundled `@parasor/shared` with the workspace
//      symlink during reify, which then trips EPERM. dist/package.json
//      declares no workspaces, so npm performs a clean publish-style
//      install.
const packTmp = mkdtempSync(join(tmpdir(), "parasor-pack-"));
// `finally` only runs on normal completion / thrown error. SIGINT or
// SIGTERM during npm pack / npm install would leave the tarball dir
// behind. Hook both signals to clean up, then re-raise the default
// behavior so the user's interrupt still terminates the script.
const cleanupOnSignal = (sig) => {
  try {
    rmSync(packTmp, { recursive: true, force: true });
  } catch {
    // best-effort
  }
  process.kill(process.pid, sig);
};
const onSigint = () => cleanupOnSignal("SIGINT");
const onSigterm = () => cleanupOnSignal("SIGTERM");
process.once("SIGINT", onSigint);
process.once("SIGTERM", onSigterm);
try {
  log(`${npmCmd} pack --pack-destination ${packTmp} (cwd=${distDir})`);
  const packRes = spawnSync(
    npmCmd,
    ["pack", "--silent", "--pack-destination", packTmp],
    {
      stdio: ["inherit", "pipe", "inherit"],
      cwd: distDir,
      encoding: "utf8",
      env: npmEnv,
    },
  );
  if (packRes.status !== 0) {
    throw new Error(`npm pack exited with ${packRes.status}`);
  }
  const tarballName = packRes.stdout.trim().split("\n").pop();
  if (!tarballName) {
    throw new Error("npm pack produced no tarball name");
  }
  const tarballPath = join(packTmp, tarballName);
  if (!existsSync(tarballPath)) {
    throw new Error(
      `expected tarball at ${tarballPath} but it was not produced`,
    );
  }
  run(npmCmd, ["install", "-g", tarballPath], distDir, npmEnv);
} finally {
  process.removeListener("SIGINT", onSigint);
  process.removeListener("SIGTERM", onSigterm);
  rmSync(packTmp, { recursive: true, force: true });
}

const installedPkg = join(
  installPrefix,
  "lib/node_modules/parasor/package.json",
);
const installedBin = join(installPrefix, "bin/parasor");
if (!existsSync(installedPkg) || !existsSync(installedBin)) {
  throw new Error(
    `install verification failed: expected ${installedPkg} and ${installedBin}`,
  );
}

log("");
log("parasor is now installed globally.");
log("Verify with:  which parasor && parasor --help");
log("Refresh after source changes:  pnpm install:local (idempotent)");
log("Uninstall with:  pnpm uninstall:local");

/*
 * daemon protocol mismatch recovery -- predict the daemon-protocol-mismatch recovery path. If a
 * parasor-pty-host daemon is already running, the next `parasor` (or
 * `parasor service restart`) detects an incompatible PROTOCOL_VERSION
 * by NACKing HELLO, then terminates the daemon and respawns it. PTY
 * sessions die in that transition. We don't read the daemon's actual
 * version (no cheap probe without the SDK), so we hint rather than
 * promise.
 */
if (isDaemonRunning()) {
  log("");
  log(
    "Note: a parasor-pty-host daemon is running. If this rebuild changed the",
  );
  log(
    "daemon IPC protocol, the next `parasor` start will terminate any active",
  );
  log(
    "PTY sessions and respawn the daemon (see daemon protocol mismatch recovery).",
  );
}

function isDaemonRunning() {
  const candidates = [];
  const override = process.env.PARASOR_PTY_SOCK;
  if (override) candidates.push(`${override}.pid`);
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg) candidates.push(join(xdg, "parasor", "parasor-pty.pid"));
  candidates.push(join(homedir(), ".parasor", "run", "parasor-pty.pid"));
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const pid = Number(readFileSync(path, "utf8").trim());
    if (!Number.isFinite(pid) || pid <= 0) continue;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err) {
      if (err && err.code === "EPERM") return true;
    }
  }
  return false;
}
