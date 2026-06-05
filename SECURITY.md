# Security Policy

## Supported deployment tiers

parasor is a "mobile vibe coding" supervision UI -- the expected operator is a
single user supervising their own dev machine from a trusted endpoint. It is
not designed as a shared team service, multi-tenant terminal gateway, CI/CD
relay, or hosted SaaS control plane. The default bind, auth, and origin
posture is tuned for that identity. Two deployment tiers are supported; one
is explicitly out of scope.

### Tier L -- Trusted-network access (supported)

parasor listens on a network where every reachable peer is operator-trusted --
either by network topology (LAN, ISP-NAT'd home WiFi) or by a zero-trust
overlay that enforces peer identity before any TCP reaches parasor.

Examples:

- `127.0.0.1` (loopback only -- `parasor --host 127.0.0.1`)
- Default `0.0.0.0` bind on a private LAN whose router does not forward the
  port to the public internet
- Default `0.0.0.0` bind plus **Tailscale**: `tailscale up` on both ends and
  the phone connects to the Tailnet IP or MagicDNS hostname. Tailscale's mesh
  identity gate is the trust boundary; the public-internet leg never touches
  parasor.
- Default `0.0.0.0` bind plus **WireGuard / other zero-trust overlay** with
  equivalent peer-identity enforcement
- **Cloudflare Access / other identity-aware proxy** in front of parasor,
  terminating TLS and enforcing SSO + device posture before forwarding to a
  loopback-bound parasor (or to parasor over a private overlay)
- **SSH port-forward.** `ssh -L 7681:127.0.0.1:7681 user@host` to a
  `parasor --host 127.0.0.1` on the remote side

Threat model: every host that can complete a TCP handshake to parasor is
operator-trusted. Public WiFi, coffee shops, conference networks, and
coworking spaces do **not** qualify on their own -- combine with an overlay or
restrict the bind to loopback.

### Tier P -- Direct public internet exposure (NOT supported)

Binding parasor's listener directly on a publicly routable NIC (e.g. `0.0.0.0`
on a VPS with no fronting proxy and no overlay) is **out of scope**. parasor
does not ship:

- TLS termination
- Rate limiting or brute-force throttles
- Auth hardening for automated scanning (token is high-entropy but not rotated)
- WAF / request filtering
- Per-tenant isolation

If you want public-URL accessibility, put parasor behind something that does
ship those guarantees (Cloudflare Tunnel + Access, or a reverse proxy you
already trust in production with identity-aware middleware in front of it).
That configuration is Tier L, not Tier P, because the identity gate is in
front of parasor.

### Self-hosted identity-aware proxy checklist

If you front parasor with your own identity-aware proxy (Authelia,
oauth2-proxy, Keycloak + reverse proxy, commercial zero-trust offerings,
etc.) instead of Cloudflare Tunnel + Access, the setup only qualifies as
Tier L if **all** of the following hold:

- **Peer identity is enforced before TCP reaches parasor.** SSO, mTLS, device
  posture, or an overlay mesh -- not just a shared password or allowlisted IP.
- **The upstream leg to parasor is not reachable from the public internet.**
  Either bind parasor to loopback and colocate the proxy, or use a private
  overlay (Tailscale, WireGuard, or equivalent) between proxy and parasor.
- **TLS terminates at the proxy** and the browser only ever talks to the
  proxy over HTTPS. parasor itself does not terminate TLS.
- **`PARASOR_ALLOWED_ORIGINS` includes the public hostname.** The WebSocket
  handshake is rejected otherwise.
- **You own the identity layer's patch / key rotation / audit log cadence.**
  The parasor maintainers cannot help you debug your SSO outage.

Tailscale Funnel exposes a public URL, but Funnel alone is not an inbound
identity gate for parasor. Treat Funnel-only exposure as **Tier P**. Use direct
Tailnet peer access or Cloudflare Tunnel + Access if you need a public entry
point.

These tiers describe the configurations the maintainers design and test for;
they are not a security warranty for a particular network, proxy, device, or
operational environment.

## Default posture

- **Bind:** `0.0.0.0` (all IPv4 interfaces). Matches the dominant pattern
  across self-hosted dev / web-terminal tools (ttyd / gotty / wetty / Vite
  `--host` / Next.js dev). Restrict with `--host 127.0.0.1` when LAN /
  Tailscale reachability is not wanted.
- **Auth:** `PARASOR_AUTH=token` -- high-entropy bearer token in the URL
  query, persisted at `~/.config/parasor/token`.
- **Origin allowlist:** WebSocket upgrade is rejected unless the `Origin`
  header matches loopback on the listen port, the explicit bind host, an
  enumerated non-internal interface address when bound to `0.0.0.0` / `::`,
  the Tailscale MagicDNS hostname (when Tailscale is running), or an entry
  in `PARASOR_ALLOWED_ORIGINS`. Missing `Origin` (non-browser clients) is
  allowed; the bearer token is still required in `PARASOR_AUTH=token` mode.

## Safety gates

parasor refuses to start if it detects an obviously unsafe combination:

- `PARASOR_AUTH=none` with a non-loopback bind. Either keep auth enabled
  (remove `PARASOR_AUTH=none`) or restrict the bind: `--host 127.0.0.1`. The
  opt-out `PARASOR_ALLOW_UNSAFE=1` exists for integration tests only.

## Reporting a vulnerability

Please use GitHub Security Advisories to report vulnerabilities privately:

<https://github.com/artcodec-hq/parasor/security/advisories/new>

Do not open public issues for security reports.

We aim to acknowledge private reports within 7 calendar days and will
coordinate disclosure through the advisory thread. If GitHub private
reporting is unavailable, contact the maintainers through the project
profile and do not include exploit details in public channels.

For confirmed vulnerabilities with external impact, we will publish a
GitHub Security Advisory and request a CVE when appropriate.
