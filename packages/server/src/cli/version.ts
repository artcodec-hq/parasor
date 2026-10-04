import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageJson {
  name?: string;
  version?: string;
}

export function resolveAppVersion(
  startDir = dirname(fileURLToPath(import.meta.url)),
): string {
  let dir = startDir;
  while (true) {
    const candidate = join(dir, "package.json");
    try {
      const pkg = JSON.parse(readFileSync(candidate, "utf8")) as PackageJson;
      if (pkg.name === "parasor" && typeof pkg.version === "string") {
        return pkg.version;
      }
    } catch {
      // Keep walking toward the repository or published package root.
    }

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  throw new Error("Unable to resolve parasor package version");
}

export function printVersion(log: (line: string) => void = console.log): void {
  log(resolveAppVersion());
}
