import { unlinkSync } from "node:fs";
import { createServer } from "node:net";
import writeFileAtomic from "write-file-atomic";

export async function probePort(
  from: number,
  attempts: number,
  hostname: string,
): Promise<number> {
  for (let offset = 0; offset < attempts; offset++) {
    const candidate = from + offset;
    const available = await new Promise<boolean>((resolve) => {
      const tester = createServer();
      tester.once("error", (err: NodeJS.ErrnoException) => {
        tester.close();
        resolve(err.code !== "EADDRINUSE");
      });
      tester.once("listening", () => {
        tester.close(() => resolve(true));
      });
      tester.listen(candidate, hostname);
    });

    if (available) return candidate;
  }

  throw new Error(
    `No free port found in range ${from}..${from + attempts - 1} on ${hostname}`,
  );
}

export function writeRuntimeFile(
  runtimeFile: string,
  hostname: string,
  actualPort: number,
): void {
  /*
   * Atomic tmp-file-then-rename: previous implementation used a plain
   * writeFileSync which could produce a partially-written file that
   * readers (`parasor qr`, service wrappers) would parse as invalid JSON
   * if they raced the server's startup. write-file-atomic's sync path
   * writes to <file>.<randomsuffix>, fsyncs, then renames -- either
   * readers see the old bytes or the new bytes, never a torn write.
   */
  try {
    writeFileAtomic.sync(
      runtimeFile,
      JSON.stringify(
        {
          port: actualPort,
          bindHost: hostname,
          pid: process.pid,
          startedAt: Date.now(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.warn(`Failed to write runtime.json: ${(error as Error).message}`);
  }
}

export function removeRuntimeFile(runtimeFile: string): void {
  try {
    unlinkSync(runtimeFile);
  } catch {
    // Already gone or never written -- nothing to clean up.
  }
}
