# AX Code Desktop Web Runtime

This package contains the local web runtime used by AX Code Desktop during
development, packaging, and local workstation access.

For normal use, install AX Code Desktop from the desktop release artifacts. The
web runtime is primarily for local development and diagnostics.

## Prerequisites

- AX Code CLI installed and signed in
- Node.js 24
- pnpm 10.33.4

## Development Start

From the repository root:

```bash
pnpm install
pnpm --filter ax-code-desktop run start -- --ui-password your-password
```

The runtime prefers `http://localhost:3100` by default. If that port is busy, it scans upward and uses the next safe free port.

## Operator CLI Usage

The web runtime CLI name is `ax-code-desktop`. Use it for development,
diagnostics, or local workstation use only. Normal macOS and Windows
users should install and update the desktop app through the release assets,
Homebrew cask on macOS, or the in-app desktop updater.

```bash
ax-code-desktop
ax-code-desktop --port 8080
ax-code-desktop --ui-password secret
ax-code-desktop logs
ax-code-desktop stop
```

Some internal environment variables and data paths still use the
`AX_CODE_DESKTOP_` prefix or `openchamber` directory name for compatibility with
existing installations. Treat those as legacy compatibility names, not product
branding.

## Existing Local AX Code Server

Use these when AX Code is already running on the same workstation:

```bash
AX_CODE_PORT=4096 AX_CODE_SKIP_START=true ax-code-desktop
AX_CODE_HOST=http://127.0.0.1:4096 AX_CODE_SKIP_START=true ax-code-desktop
```

| Variable                           | Description                                                                       |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `AX_CODE_HOST`                     | Loopback URL of an existing AX Code server. Takes precedence over `AX_CODE_PORT`. |
| `AX_CODE_PORT`                     | Port of an existing local AX Code server.                                         |
| `AX_CODE_SKIP_START`               | Set to `true` to prevent AX Code Desktop from starting its own AX Code server.    |
| `AX_CODE_DESKTOP_AX_CODE_HOSTNAME` | Loopback hostname for the managed AX Code server.                                 |
| `AX_CODE_DESKTOP_HOST`             | Loopback hostname for the AX Code Desktop web server.                             |

Network addresses, wildcard binds, reverse proxies, remote hosts, and public tunnels are rejected by the local-only policy.

## Startup Service

```bash
ax-code-desktop startup enable
ax-code-desktop startup status
ax-code-desktop startup disable
```

`startup enable` snapshots the current environment so provider tokens, `PATH`,
SSH agent settings, and other CLI auth/config variables remain available to the
service. Use `--no-env-snapshot` for a minimal service environment.

## Persistent Data

For local containers, mount persistent storage for the legacy app data path,
AX Code config, and any Git SSH material:

```bash
mkdir -p data/openchamber data/ax-code/share data/ax-code/config data/ssh
chown -R 1000:1000 data/
```

The `data/openchamber` path is retained for compatibility.

## License

MIT. This package is part of AX Code Desktop and follows the repository-level
license and provenance notice in [../../NOTICE](../../NOTICE).
