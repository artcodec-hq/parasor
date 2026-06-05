import { execFileSync } from "node:child_process";
import { createConnection } from "node:net";

// Flags that take a value argument (macOS `open` specific)
const VALUE_FLAGS = new Set(["-a", "-b", "--args"]);

interface ParsedArgs {
  kind: string;
  flags: string[];
  positionals: string[];
  hasAppFlag: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let kind = "macos-open";
  const flags: string[] = [];
  const positionals: string[] = [];
  let hasAppFlag = false;
  let pastSeparator = false;

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];

    if (arg === "--") {
      pastSeparator = true;
      i++;
      continue;
    }

    if (!pastSeparator) {
      if (arg === "--kind" || arg.startsWith("--kind=")) {
        kind = arg.includes("=") ? arg.split("=")[1] : argv[++i];
        i++;
        continue;
      }
    }

    if (pastSeparator && arg.startsWith("-")) {
      if (arg === "-a") hasAppFlag = true;
      flags.push(arg);
      if (VALUE_FLAGS.has(arg) && i + 1 < argv.length) {
        i++;
        flags.push(argv[i]);
      }
    } else if (pastSeparator) {
      positionals.push(arg);
    }
    i++;
  }

  return { kind, flags, positionals, hasAppFlag };
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function sendToSocket(
  url: string,
  projectId: string,
  socketPath: string,
): Promise<boolean> {
  return new Promise((resolve) => {
    const client = createConnection(socketPath, () => {
      client.write(
        `${JSON.stringify({ cmd: "open", args: { url, projectId } })}\n`,
      );
    });

    let data = "";
    client.on("data", (chunk) => {
      data += chunk;
    });
    client.on("end", () => {
      try {
        const resp = JSON.parse(data.trim()) as { ok: boolean };
        resolve(resp.ok);
      } catch {
        resolve(false);
      }
    });
    client.on("error", () => resolve(false));
    client.setTimeout(2000, () => {
      client.destroy();
      resolve(false);
    });
  });
}

function execReal(kind: string, originalArgv: string[]): never {
  const realPath =
    kind === "xdg-open"
      ? process.env.PARASOR_REAL_XDG_OPEN
      : process.env.PARASOR_REAL_OPEN;

  if (!realPath) {
    console.error(`parasor shim-open: real binary not found for ${kind}`);
    process.exit(1);
  }

  try {
    execFileSync(realPath, originalArgv, { stdio: "inherit" });
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

export async function shimOpen(argv: string[]): Promise<void> {
  const parsed = parseArgs(argv);

  // Extract original argv (everything after --)
  const separatorIdx = argv.indexOf("--");
  const originalArgv = separatorIdx >= 0 ? argv.slice(separatorIdx + 1) : [];

  const urlCandidates = parsed.positionals.filter(isHttpUrl);
  const nonUrlPositionals = parsed.positionals.filter((p) => !isHttpUrl(p));

  // Rule 4: No URL candidates -> pass through
  if (urlCandidates.length === 0) {
    execReal(parsed.kind, originalArgv);
  }

  // Rule 5: Mixed URLs and non-URLs -> pass through
  if (nonUrlPositionals.length > 0) {
    execReal(parsed.kind, originalArgv);
  }

  // Rule 7: -a flag specified -> pass through (user wants specific app)
  if (parsed.hasAppFlag) {
    execReal(parsed.kind, originalArgv);
  }

  // Rule 6: All positionals are http(s) URLs, no -a -> intercept
  const socketPath = process.env.PARASOR_SOCKET;
  const projectId = process.env.PARASOR_PROJECT_ID ?? "";

  if (!socketPath) {
    // No socket available -- fall back
    execReal(parsed.kind, originalArgv);
  }

  // Send each URL through the socket
  let allOk = true;
  for (const url of urlCandidates) {
    const ok = await sendToSocket(url, projectId, socketPath);
    if (!ok) {
      allOk = false;
      break;
    }
  }

  if (!allOk) {
    // Socket failed -- fall back to real binary
    console.error("parasor: socket unavailable, falling back to system open");
    execReal(parsed.kind, originalArgv);
  }

  process.exit(0);
}
