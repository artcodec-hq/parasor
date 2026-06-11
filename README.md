# parasor

> Open-source, mobile-first workspace for operating your local development
> environment from a phone.

parasor runs on your development machine and turns it into a browser workspace
for your phone or another trusted device. The core is persistent PTY-backed
terminal control, so the host machine keeps the real project environment while
you create projects, install dependencies, run CLI tools, drive AI coding
agents, edit files, review diffs, inspect Git state, and open localhost dev
servers from mobile.

## Highlights

- **Agent-independent architecture** - parasor is built around persistent PTY
  terminal control, not a specific agent runtime. Use Codex, Claude Code,
  ordinary shell tools, package managers, or existing project workflows as-is.
- **All-in-one mobile UI** - terminal, Git state, file tree, editor, diff,
  browser views, localhost dev servers, and agent status are integrated in one
  browser workspace.
- **Practical mobile development** - QR login, mobile terminal key controls,
  clipboard/file upload, and persistent PTYs keep work usable from a phone.
- **Persistent PTYs** - the user-scope service installs a PTY host daemon so
  scrollback and sessions survive server restarts.
- **Agent-aware shims** - Claude Code and Codex wrappers add runtime integration
  hooks without editing user agent configuration files.
- **Network port center** - detected localhost dev servers can be opened from
  mobile through parasor-managed reachable URLs when needed.
- **Token auth + Origin allowlist** - high-entropy URL token and browser
  Origin checks are enabled by default.
- **macOS / Linux primary** - user-scope install and service management, no
  sudo required. WSL is expected to work for foreground use, with service mode
  depending on systemd-enabled WSL. Native Windows is not currently supported.

## Quick Start

Install with Node.js 22+:

```bash
npm install -g parasor
parasor
```

One-off run:

```bash
npm exec -y parasor
# or: npx parasor
```

pnpm users must allow native dependency builds:

```bash
pnpm dlx --allow-build=node-pty,@parcel/watcher parasor
```

parasor listens on every IPv4 interface (`0.0.0.0`) at port `7681` by default,
matching common local-dev tools such as ttyd, gotty, Vite `--host`, and Next.js
dev. The startup banner prints reachable access URLs for loopback, LAN, and
Tailscale endpoints, followed by a QR code for phone access.

Token auth and WebSocket Origin checks are the primary defense. Use
`--host 127.0.0.1` or `HOST=127.0.0.1` for loopback-only access.

```bash
parasor --help             # user-facing subcommands
parasor qr                 # re-render QR + access URLs over the IPC socket
parasor qr --iface=en0     # prefer a specific network interface
```

## Update / Uninstall

Update a global install:

```bash
npm install -g parasor@latest
parasor service restart    # if service mode is installed
```

Uninstall the service before removing the package:

```bash
parasor service uninstall
npm uninstall -g parasor
```

## Background Service

Keep parasor up after login. On macOS, the LaunchAgent also starts at user
login after reboot. On Linux, the systemd user unit starts with the user
session; start-before-login behavior depends on whether lingering is enabled
for that account.

Service mode requires a globally installed `parasor` command.

```bash
parasor service install     # LaunchAgent on macOS, systemd user unit on Linux
parasor service status      # installed / running / pid / uptime
parasor service restart     # restart the service
parasor service logs -f     # tail the service log
parasor service uninstall   # stop + unregister
```

The service is user-scope only and does not require sudo. The supervisor
restarts the server if it crashes, and the PTY host daemon keeps PTY sessions
available across server restarts.

## Agent Integrations

On startup, parasor installs user-scope shims under `~/.config/parasor` (or
`$PARASOR_CONFIG_DIR` when set) and prepends them only to PTYs spawned by
parasor. There is no `postinstall` hook, no sudo path, and no write to global
shell startup files.

The shims wrap Claude Code and Codex when they are launched inside parasor
terminals so the UI can show agent state and attach session context. Outside a
parasor PTY, the wrappers resolve and exec the real binaries.

## Remote Access

parasor itself does not ship a tunnel. The expected mobile flow is: parasor
runs on your dev machine, and the phone reaches it over a trusted network.

- **Same LAN.** Default bind already covers it. Scan the QR from a phone on the
  same Wi-Fi.
- **Tailscale.** With Tailscale running on both ends, the Tailnet IP and
  MagicDNS hostname are reachable on the default bind.
- **Cloudflare Tunnel + Access, or equivalent identity-aware proxy.** Use this
  when you need a stable public URL with SSO or device posture enforced before
  any request reaches parasor.
- **SSH port-forward.** Run `parasor --host 127.0.0.1` on the remote side and
  connect with `ssh -L 7681:127.0.0.1:7681 user@host`.

Direct exposure on a public IP, such as binding `0.0.0.0` on a VPS without an
overlay or identity-aware proxy in front, is out of scope. See
[SECURITY.md](./SECURITY.md) for the threat model.

## Opening Localhost Dev Servers From Mobile

When a terminal prints a loopback URL such as `http://localhost:5173`, opening
that URL on a phone would normally target the phone's own localhost. parasor can
rewrite detected loopback dev-server URLs to a reachable address on the parasor
host, using a per-port forwarder when needed.

Most dev servers do not have parasor's token auth. Expose them directly only on
a trusted LAN or Tailnet.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `7681` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address; set `127.0.0.1` for loopback-only |
| `PARASOR_AUTH` | `token` | `token` or `none`; `none` is allowed only on loopback binds |
| `PARASOR_CONFIG_DIR` | `~/.config/parasor` | Persistent state directory |
| `PARASOR_ALLOWED_ORIGINS` | empty | Extra browser origins for WebSocket allowlist |

## Development

```bash
pnpm install
pnpm dev          # backend on :7682, Vite on :7683
pnpm test
pnpm lint
pnpm build        # TypeScript + Vite build
pnpm package      # assemble publishable dist/
```

Requires Node.js 22+ and pnpm. macOS and Linux are primary. WSL is expected to
work for foreground use, but service mode requires systemd-enabled WSL. Native
Windows is not currently supported.

Release and beta branch procedures are documented in [docs/release.md](./docs/release.md).

## Status

Pre-1.0. Configuration shape and CLI surface may change before `1.0.0`.

## License

MIT - see [LICENSE](./LICENSE).

## Acknowledgements

Built with [Hono](https://hono.dev), [node-pty](https://github.com/microsoft/node-pty),
[xterm.js](https://xtermjs.org), [React](https://react.dev),
[Vite](https://vitejs.dev), [Tailwind CSS](https://tailwindcss.com), and
[CodeMirror](https://codemirror.net).
