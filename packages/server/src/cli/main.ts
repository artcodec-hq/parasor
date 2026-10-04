// Single-source CLI dispatcher.
// bin/parasor.ts (dev) and dist/bin/parasor.mjs (publish) both delegate here
// so subcommand surface cannot drift between dev and published binaries.

export async function runCli(args: string[]): Promise<void> {
  const command = args[0];

  switch (command) {
    case "version":
    case "--version":
    case "-v": {
      const { printVersion } = await import("./version.js");
      printVersion();
      return;
    }
    case "help":
    case "--help":
    case "-h": {
      const { printHelp } = await import("./help.js");
      printHelp();
      return;
    }
    case "--help-all":
    case "help-all": {
      const { printHelpAll } = await import("./help.js");
      printHelpAll();
      return;
    }
    case "open": {
      const url = args[1];
      if (!url) {
        console.error("Usage: parasor open <url>");
        process.exit(1);
      }
      const { cliOpen } = await import("./open.js");
      await cliOpen(url);
      return;
    }
    case "shim-open": {
      const { shimOpen } = await import("./shim-open.js");
      await shimOpen(args.slice(1));
      return;
    }
    case "notify": {
      const { cliNotify } = await import("./notify.js");
      await cliNotify(args.slice(1));
      return;
    }
    case "hook": {
      const { cliHook } = await import("./hook.js");
      await cliHook(args.slice(1));
      return;
    }
    case "qr": {
      const { cliQr } = await import("./qr.js");
      await cliQr(args.slice(1));
      return;
    }
    case "service": {
      const { cliService } = await import("./service.js");
      try {
        await cliService(args.slice(1));
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
      return;
    }
    case "restart": {
      const { cliRestart } = await import("./restart.js");
      try {
        await cliRestart(undefined, args.slice(1));
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
      return;
    }
    case "stop": {
      const { cliStop } = await import("./stop.js");
      try {
        await cliStop(undefined, args.slice(1));
      } catch (err) {
        console.error((err as Error).message);
        process.exit(1);
      }
      return;
    }
    case "pty-host": {
      const { cliPtyHost } = await import("./pty-host.js");
      const rc = await cliPtyHost(args.slice(1));
      process.exit(rc);
      return;
    }
    default: {
      const { classifyTopLevelCommand } = await import("./unknown-command.js");
      const classified = classifyTopLevelCommand(command);
      if (classified.kind === "error") {
        console.error(classified.message);
        process.exit(1);
      }
      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === undefined) continue;
        if (arg === "--no-qr") {
          process.env.PARASOR_QR = "0";
        } else if (arg.startsWith("--qr=")) {
          process.env.PARASOR_QR_IFACE = arg.slice(5);
        } else if (arg === "--host") {
          const value = args[++i];
          if (!value) {
            console.error("--host requires a value");
            process.exit(1);
          }
          process.env.HOST = value;
        } else if (arg.startsWith("--host=")) {
          process.env.HOST = arg.slice(7);
        } else if (arg === "--port") {
          const value = args[++i];
          if (!value) {
            console.error("--port requires a value");
            process.exit(1);
          }
          process.env.PORT = value;
        } else if (arg.startsWith("--port=")) {
          process.env.PORT = arg.slice(7);
        }
      }
      await import("../index.js");
    }
  }
}
