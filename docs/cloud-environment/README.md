# Claude cloud environment for Bo (and Spearfish)

Everything needed to recreate the cloud environment Claude works in. Cloud
environments can't be copied, so a new one is these four settings typed in.
Settings live in the environment selector under the message box at
claude.ai/code → **New environment** (or an existing one's settings icon).

## 1. Name

`Bo + Spearfish`. It's one environment for both: the network and tools cover
both repos, and the repository is picked per session, not per environment.

## 2. Network access → **Full**

**Full** means any domain, so a session is never blocked on a host nobody
thought to list. That's the setting for "work for me without asking".

**What Full costs you:** nothing stops a session reaching any site. Claude
still asks before anything outward-facing, and the environment holds no
secrets unless you add them, but Full is a deliberate trade of fence for
convenience. It's a fine trade for a personal environment.

**If you'd rather keep a fence**, choose **Custom**, tick **Also include
default list of common package managers** (that list already covers GitHub,
npm, PyPI, NuGet, Docker Hub, Ubuntu, `*.googleapis.com`, `*.amazonaws.com`,
and more), and paste [`allowed-domains.txt`](allowed-domains.txt) into
**Allowed domains**. It adds what the defaults miss, grouped as:

- your domains (`bohac.dev`, `bohac.me`, `bohac.com`, `spearfish.ai`)
- .NET downloads (the one that blocked this session: `builds.dotnet.microsoft.com`)
- Expo / EAS, Fly.io, Neon, Google sign-in, Apple
- Spearfish's services (Vercel, Vercel Blob, Azure Blob backups, HubSpot,
  Slack, SendGrid, the AI providers, ElevenLabs, fal)
- documentation sites, and Home Assistant / Tailscale / Cloudflare for later

The trade-off is maintenance: every new service is a line to add.

Reaching these doesn't depend on the network level, at Full or Custom:

- **GitHub** goes through its own proxy.
- **Connectors** (Gmail, Calendar, Drive, Slack, HubSpot, the Spearfish MCP
  servers) travel through Anthropic's servers.

## 3. Environment variables

Paste [`env-vars.txt`](env-vars.txt): telemetry off for .NET and Expo, and
longer command timeouts (5-minute default, 15-minute max) so builds don't get
pushed to the background.

**Every session can read these values.** Don't put tokens here unless you
accept that. For a key an API takes in a header, use **Network secrets**
instead: it's attached to requests outside the sandbox and never visible to
the session.

## 4. Setup script

Paste [`setup.sh`](setup.sh) (or **Choose file**). It runs as root on Ubuntu
24.04 and installs:

- the .NET 10 SDK, from Ubuntu's archive
- `eas-cli` for Expo builds, submits and updates
- the Docker images Bo uses, pre-pulled
- `docker-build-sandbox`, a `docker build` wrapper (next section)

It runs in about 45 seconds. Anything under about 5 minutes is cached, so
later sessions skip it entirely and start with all of this on disk. Docker
and PostgreSQL 16 are already in the base image; a session starts their
daemons itself when it needs them.

### Why `docker-build-sandbox`

The session's network goes through a TLS proxy that containers built inside
the session don't trust, so a plain `docker build` fails on its first package
restore (`UntrustedRoot`). The wrapper builds a throwaway copy of the
Dockerfile that trusts the proxy. Your real Dockerfile is never touched, so
CI and Fly build exactly what's committed. For Bo, from the repo root:
`docker-build-sandbox -f api/Dockerfile -t bo-api .`

## Still needs you, at any network level

Accounts that sign in through a browser can't be done from a session: Fly,
Expo, Apple, Google Cloud and Neon. The one-time steps are in
[`../SETUP.md`](../SETUP.md).

To let sessions deploy or build on their own afterwards, they need tokens:

- **`FLY_API_TOKEN`**: from `fly tokens create deploy`.
- **`EXPO_TOKEN`**: an Expo access token.

Both CLIs read the token from an environment variable, so the trade-off above
applies: every session can read it. It's your call whether that's acceptable
for a personal environment.
