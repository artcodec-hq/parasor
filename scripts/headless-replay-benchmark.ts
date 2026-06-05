import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  buildHeadlessReplaySnapshot,
  HeadlessTerminalState,
} from "../packages/server/src/pty/headless-replay-snapshot.ts";

interface Options {
  dir: string;
  cols: number;
  rows: number;
  scrollbackLines: number;
  maxBytes: number;
  json: boolean;
}

function readPositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readOptions(argv: string[]): Options {
  const options: Options = {
    dir: process.env.PARASOR_HEADLESS_BENCH_DIR ?? "/tmp/parasor-dev/sessions",
    cols: readPositiveInteger(process.env.PARASOR_HEADLESS_BENCH_COLS, 45),
    rows: readPositiveInteger(process.env.PARASOR_HEADLESS_BENCH_ROWS, 27),
    scrollbackLines: readPositiveInteger(
      process.env.PARASOR_HEADLESS_REPLAY_SCROLLBACK_LINES,
      10_000,
    ),
    maxBytes: readPositiveInteger(
      process.env.PARASOR_HEADLESS_REPLAY_MAX_BYTES,
      1024 * 1024,
    ),
    json: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--dir" && next) {
      options.dir = next;
      i += 1;
    } else if (arg === "--cols" && next) {
      options.cols = readPositiveInteger(next, options.cols);
      i += 1;
    } else if (arg === "--rows" && next) {
      options.rows = readPositiveInteger(next, options.rows);
      i += 1;
    } else if (arg === "--scrollback-lines" && next) {
      options.scrollbackLines = readPositiveInteger(
        next,
        options.scrollbackLines,
      );
      i += 1;
    } else if (arg === "--max-bytes" && next) {
      options.maxBytes = readPositiveInteger(next, options.maxBytes);
      i += 1;
    } else if (arg === "--json") {
      options.json = true;
    }
  }

  return options;
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  const files = readdirSync(options.dir)
    .filter((name) => name.endsWith(".log"))
    .map((name) => {
      const path = join(options.dir, name);
      return { name, path, size: statSync(path).size };
    })
    .sort((a, b) => b.size - a.size);

  const rows = [];
  for (const file of files) {
    const raw = readFileSync(file.path, "utf8");
    const snapshot = await buildHeadlessReplaySnapshot(raw, options);
    const warmState = new HeadlessTerminalState(options);
    await warmState.write(raw);
    const warmSnapshot = await warmState.snapshot();
    rows.push({
      session: file.name.replace(/\.log$/, ""),
      rawBytes: snapshot.rawBytes,
      snapshotBytes: snapshot.snapshotBytes,
      ratio: Number(
        (snapshot.snapshotBytes / Math.max(1, snapshot.rawBytes)).toFixed(4),
      ),
      rebuildDurationMs: snapshot.durationMs,
      warmSnapshotDurationMs: warmSnapshot.durationMs,
      bufferLines: snapshot.bufferLines,
      emittedLines: snapshot.emittedLines,
    });
  }

  if (!options.json) {
    console.error(
      `headless replay benchmark dir=${options.dir} cols=${options.cols} rows=${options.rows} scrollbackLines=${options.scrollbackLines} maxBytes=${options.maxBytes}`,
    );
    console.table(rows);
  }
  console.log(JSON.stringify({ options, rows }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
