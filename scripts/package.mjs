#!/usr/bin/env node

// Assemble a publishable `dist/` tree from the monorepo build output.
// Layout produced:
//   dist/
//     bin/parasor.mjs
//     server/                                 (packages/server/dist/*)
//     web/                                    (packages/web/dist/*)
//     node_modules/@parasor/shared/           (bundled workspace dep)
//     package.json                            (publish manifest, name="parasor")
//     THIRD-PARTY-NOTICES.md
//
// Run from repo root: `node scripts/package.mjs` (build must be fresh; pass
// --build to run `pnpm build` first).

import { spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..");
const distDir = join(repoRoot, "dist");

const args = new Set(process.argv.slice(2));
const doBuild = args.has("--build");

function log(msg) {
  process.stdout.write(`[package] ${msg}\n`);
}

function run(cmd, cmdArgs, opts = {}) {
  const res = spawnSync(cmd, cmdArgs, {
    stdio: "inherit",
    cwd: repoRoot,
    ...opts,
  });
  if (res.status !== 0) {
    throw new Error(`${cmd} ${cmdArgs.join(" ")} exited with ${res.status}`);
  }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

if (doBuild) {
  log("running pnpm build");
  run("pnpm", ["build"]);
}

const serverDist = join(repoRoot, "packages/server/dist");
const webDist = join(repoRoot, "packages/web/dist");
if (!existsSync(serverDist))
  throw new Error(
    `missing ${serverDist}; run pnpm build first or pass --build`,
  );
if (!existsSync(webDist))
  throw new Error(`missing ${webDist}; run pnpm build first or pass --build`);

log(`cleaning ${distDir}`);
rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

log("copying server dist -> dist/server (excluding tests)");
cpSync(serverDist, join(distDir, "server"), {
  recursive: true,
  filter: (src) => {
    const base = src.split("/").pop() ?? "";
    return !/\.test\.(js|d\.ts|js\.map|d\.ts\.map)$/.test(base);
  },
});

log("copying web dist -> dist/web");
cpSync(webDist, join(distDir, "web"), { recursive: true });

log("writing dist/bin/parasor.mjs");
const binDir = join(distDir, "bin");
mkdirSync(binDir, { recursive: true });
// Thin wrapper -- full dispatcher lives in packages/server/src/cli/main.ts
// so dev (bin/parasor.ts) and publish (this file) stay in lockstep.
const binSource = `#!/usr/bin/env node
import { runCli } from "../server/cli/main.js";
await runCli(process.argv.slice(2));
`;
const binPath = join(binDir, "parasor.mjs");
writeFileSync(binPath, binSource);
chmodSync(binPath, 0o755);

log("bundling @parasor/shared into dist/node_modules/@parasor/shared");
const sharedDist = join(repoRoot, "packages/shared/dist");
if (!existsSync(sharedDist)) {
  throw new Error(
    `missing ${sharedDist}; run pnpm build first or pass --build`,
  );
}
const bundledSharedDir = join(distDir, "node_modules/@parasor/shared");
mkdirSync(bundledSharedDir, { recursive: true });
cpSync(sharedDist, join(bundledSharedDir, "dist"), { recursive: true });
const sharedPkg = readJson(join(repoRoot, "packages/shared/package.json"));
// Rewrite exports to dist/ (workspace-time exports point to src/types.ts so
// tsx dev resolves source directly; published bundle must point to compiled
// JS so plain Node can resolve it after npm install).
const bundledSharedPkg = {
  name: sharedPkg.name,
  version: sharedPkg.version,
  type: sharedPkg.type ?? "module",
  exports: {
    ".": {
      types: "./dist/types.d.ts",
      default: "./dist/types.js",
    },
  },
  main: "./dist/types.js",
  types: "./dist/types.d.ts",
};
writeFileSync(
  join(bundledSharedDir, "package.json"),
  `${JSON.stringify(bundledSharedPkg, null, 2)}\n`,
);

log("writing dist/package.json");
const rootPkg = readJson(join(repoRoot, "package.json"));
const serverPkg = readJson(join(repoRoot, "packages/server/package.json"));
// Strip workspace deps (kept as bundleDependencies, see node_modules/ block above).
const runtimeDeps = Object.fromEntries(
  Object.entries(serverPkg.dependencies ?? {}).filter(
    ([name]) => !name.startsWith("@parasor/"),
  ),
);
runtimeDeps[sharedPkg.name] = sharedPkg.version;

const publishPkg = {
  name: "parasor",
  version: rootPkg.version ?? "0.0.0",
  description: "Web-based multi-client terminal multiplexer with PTY sharing.",
  keywords: [
    "terminal",
    "multiplexer",
    "pty",
    "web-terminal",
    "browser-terminal",
    "terminal-sharing",
    "remote-access",
    "remote-shell",
    "xterm",
    "tmux",
  ],
  license: "MIT",
  author: rootPkg.author ?? "akibe",
  homepage: rootPkg.homepage,
  repository: rootPkg.repository,
  bugs: rootPkg.bugs,
  type: "module",
  bin: { parasor: "./bin/parasor.mjs" },
  main: "./server/index.js",
  files: ["bin", "server", "web", "THIRD-PARTY-NOTICES.md"],
  engines: { node: ">=22" },
  dependencies: runtimeDeps,
  bundleDependencies: [sharedPkg.name],
  pnpm: rootPkg.pnpm,
};

writeFileSync(
  join(distDir, "package.json"),
  `${JSON.stringify(publishPkg, null, 2)}\n`,
);

const notices = join(repoRoot, "THIRD-PARTY-NOTICES.md");
if (existsSync(notices)) {
  cpSync(notices, join(distDir, "THIRD-PARTY-NOTICES.md"));
}

const readmeSrc = join(repoRoot, "README.md");
if (existsSync(readmeSrc)) {
  cpSync(readmeSrc, join(distDir, "README.md"));
}

const licenseSrc = join(repoRoot, "LICENSE");
if (existsSync(licenseSrc)) {
  cpSync(licenseSrc, join(distDir, "LICENSE"));
}

log(`done: ${distDir}`);
