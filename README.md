# parasor

> AI-first coding workspace for continuing your desktop development flow from
> anywhere.

parasor runs on your development machine and brings the same AI-driven coding
workflow to your desk, phone, or another trusted device. Use a browser to work
with your agents, terminals, Git state, files, and localhost dev servers
without changing the project environment on the host machine.

## Highlights

- **Multi-agent parallel panes** - split the workspace into terminal, file
  tree, editor, diff, and browser views while several agents run at once.
- **Desk-to-mobile workflow** - startup QR seeds the session cookie, mobile
  controls cover common terminal keys, and clipboard/file upload works in the
  on-page terminal.
- **Persistent PTYs** - the user-scope service installs a PTY host daemon so
  scrollback and sessions survive server restarts.
- **Project-scoped file ops** - browse files, edit in CodeMirror, open diffs,
  drag files into terminals, and paste images into an upload directory.
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

Node.js 22+:

```bash
pnpm dlx parasor
# or: npm exec -y parasor
```

parasor listens on every IPv4 interface (`0.0.0.0`) at port `7681` by default,
matching common local-dev tools such as ttyd, gotty, Vite `--host`, and Next.js
dev. The startup banner prints reachable access URLs for loopback, LAN, and
Tailscale endpoints, followed by a QR code for phone access.

Token auth and WebSocket Origin checks are the primary defense. Use
`--host 127.0.0.1` or `HOST=127.0.0.1` for loopback-only access.

```bash
parasor --help             # user-facing subcommands
parasor --help-all         # also list advanced/internal bridges
parasor qr                 # re-render QR + access URLs over the IPC socket
parasor qr --iface=en0     # prefer a specific network interface
```

The auth token is persisted at `~/.config/parasor/token` (user-scope, plain
text) if you need to assemble the URL by hand.

## Background Service

Keep parasor up after login. On macOS, the LaunchAgent also starts at user
login after reboot. On Linux, the systemd user unit starts with the user
session; start-before-login behavior depends on whether lingering is enabled
for that account.

```bash
parasor service install     # LaunchAgent on macOS, systemd user unit on Linux
parasor service status      # installed / running / pid / uptime
parasor service restart     # restart the service
parasor service logs -f     # tail the service log
parasor service uninstall   # stop + unregister
```

The service is user-scope only and does not require sudo. The supervisor
restarts the server if it crashes, and the PTY host daemon keeps PTY sessions
available across server restarts. The server also exposes a loopback-only
`GET /healthz` probe for watchdogs.

## Agent PATH Shims

On startup, parasor installs user-scope shims under `~/.config/parasor` (or
`$PARASOR_CONFIG_DIR` when set) and prepends them only to PTYs spawned by
parasor. There is no `postinstall` hook, no sudo path, and no write to global
shell startup files.

Files written by the shim installer:

| Path | Purpose |
|---|---|
| `~/.config/parasor/bin/claude` | Wrapper for Claude Code |
| `~/.config/parasor/bin/codex` | Wrapper for Codex |
| `~/.config/parasor/bin/open` | macOS `open` shim, only when a real `open` is found |
| `~/.config/parasor/bin/xdg-open` | Linux `xdg-open` shim, only when a real `xdg-open` is found |
| `~/.config/parasor/shell/zsh/.zshenv` and `.zshrc` | zsh overlay that sources normal zsh files, then reasserts the parasor shim path |
| `~/.config/parasor/shell/bash/.bashrc` | bash overlay that sources normal `.bashrc`, then reasserts the parasor shim path |

The Claude wrapper runs the real `claude` binary after injecting runtime hooks
for the current invocation. The hooks call back to the local parasor server so
the UI can show agent running, waiting, and completed states. When file drops
are available, the wrapper also adds the session upload directory through
Claude's CLI flags. It does not edit `~/.claude/settings.json`.

The Codex wrapper runs the real `codex` binary with a per-process notification
setting, records the Codex TUI session log, and mirrors task and approval
events back to parasor. It does not edit `~/.codex` config or change
`CODEX_HOME`.

The `open` and `xdg-open` shims route explicit terminal URL opens through
parasor's browser deep-link path when the command is run inside a parasor PTY.
Outside a live parasor session, the wrappers resolve and exec the real
binaries.

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

`PARASOR_AUTH=none` refuses to start on a non-loopback bind.
`PARASOR_ALLOWED_ORIGINS` adds extra browser origins for custom hostnames and
reverse proxies.

## Opening Localhost Dev Servers From Mobile

When a terminal prints a loopback URL such as `http://localhost:5173`, opening
that URL on a phone would normally target the phone's own localhost. parasor
rewrites terminal and port-center open actions for detected loopback ports to a
reachable address on the parasor host, using a per-port TCP forwarder when the
dev server is bound to loopback only.

This is different from opening the app's port directly over Tailscale or LAN:
`http://<dev-machine-tailnet-name>:5173` only works if that app is listening on
a non-loopback interface. For Vite, that usually means `vite --host 0.0.0.0`
or `server.host = "0.0.0.0"`.

Security note: most dev servers do not have parasor's token auth. Use direct
`--host 0.0.0.0` dev-server exposure only on a trusted LAN or Tailnet. If you
only need to open the app from parasor, leaving the dev server loopback-bound
and using parasor's generated forwarder URL keeps exposure aligned with
parasor's own network surface.

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
pnpm test         # all workspaces
pnpm typecheck    # TypeScript checks across packages
pnpm lint         # Biome + layer boundary checks
pnpm lint:fix     # apply Biome fixes
pnpm build        # TypeScript + Vite build
pnpm package      # assemble publishable dist/
pnpm clean        # remove build outputs
pnpm clean:dev    # stop dev leftovers and clear dev lockfiles
```

For local CLI install after source changes:

```bash
pnpm install:local
pnpm uninstall:local
```

Dev mode isolates itself from a running production parasor: backend port
defaults to `7682`, the Vite dev server defaults to `7683`, and
`PARASOR_CONFIG_DIR` defaults to `/tmp/parasor-dev`.

Requires Node.js 22+ and pnpm. macOS and Linux are primary. WSL is expected to
work for foreground use, but service mode requires systemd-enabled WSL. Native
Windows is not currently supported.

## Status

Pre-1.0. Configuration shape and CLI surface may change before `1.0.0`.

## License

MIT - see [LICENSE](./LICENSE).

## Acknowledgements

Built with [Hono](https://hono.dev), [node-pty](https://github.com/microsoft/node-pty),
[xterm.js](https://xtermjs.org), [React](https://react.dev),
[Vite](https://vitejs.dev), [Tailwind CSS](https://tailwindcss.com), and
[CodeMirror](https://codemirror.net).
