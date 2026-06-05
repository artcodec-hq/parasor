import { createConnection } from "node:net";

export async function cliOpen(url: string): Promise<void> {
  const socketPath = process.env.PARASOR_SOCKET;
  if (!socketPath) {
    console.error(
      "PARASOR_SOCKET not set. Are you running inside a parasor session?",
    );
    process.exit(1);
  }

  const projectId = process.env.PARASOR_PROJECT_ID ?? "";

  try {
    const response = await sendRequest(socketPath, {
      cmd: "open",
      args: { url, projectId },
    });

    if (!(response as { ok: boolean }).ok) {
      console.error(`Failed: ${(response as { error?: string }).error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`Socket error: ${err}`);
    process.exit(1);
  }
}

function sendRequest(socketPath: string, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = createConnection(socketPath, () => {
      client.write(`${JSON.stringify(request)}\n`);
    });

    let data = "";
    client.on("data", (chunk) => {
      data += chunk;
    });
    client.on("end", () => {
      try {
        resolve(JSON.parse(data.trim()));
      } catch (e) {
        reject(e);
      }
    });
    client.on("error", reject);
    client.setTimeout(2000, () => {
      client.destroy(new Error("timeout"));
    });
  });
}
