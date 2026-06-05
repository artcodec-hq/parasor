const HELP = `parasor -- web-based multi-client terminal multiplexer

Usage:
  parasor [--host <addr>] [--port <n>] [--no-qr] [--qr=<iface>]
  parasor <command>

Commands:
  qr         Re-render QR + access URLs for a running server
  service    Install/manage as a login service (LaunchAgent / systemd user)
  restart    Restart the running server (graceful, then SIGTERM + respawn)
  stop       Stop the running server and its PTY host daemon
  help       Show this message (\`--help-all\` for advanced commands)

Run \`parasor <command> --help\` for command-specific options.
Docs:  https://github.com/artcodec-hq/parasor#readme`;

const HELP_ALL = `${HELP}

Advanced commands:
  notify     Push an agent state into a running server (manual hook bridge)
  pty-host   Manage the parasor-pty-host daemon
  open       Open a URL in the host browser (requires PARASOR_SOCKET; PTY-only)

Internal commands (not for direct use):
  hook       Agent hook bridge -- invoked by Claude Code / Codex hook systems
  shim-open  PATH shim for macOS \`open\` / Linux \`xdg-open\` -- PTY-only

Environment:
  PORT                     Listen port (default 7681)
  HOST                     Bind address (default 0.0.0.0 -- all IPv4)
  PARASOR_AUTH             token | none (default token; none requires loopback)
  PARASOR_ALLOWED_ORIGINS  Extra browser origins for WebSocket allowlist
  PARASOR_CONFIG_DIR       Persistent state dir (default ~/.config/parasor)`;

export function printHelp(log: (line: string) => void = console.log): void {
  log(HELP);
}

export function printHelpAll(log: (line: string) => void = console.log): void {
  log(HELP_ALL);
}
