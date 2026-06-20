# AX Code Desktop Web Runtime

This package contains the local web runtime used by AX Code Desktop during
development, packaging, and controlled workstation access.

For normal use, install AX Code Desktop from the desktop release artifacts. The
web runtime is primarily for development, diagnostics, and trusted local or
operator-managed deployments.

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

The runtime listens on `http://localhost:3000` by default.

## CLI Usage

The public CLI name is `ax-code-desktop`:

```bash
ax-code-desktop
ax-code-desktop --port 8080
ax-code-desktop --ui-password secret
ax-code-desktop logs
ax-code-desktop stop
ax-code-desktop update
```

Some internal environment variables and data paths still use the
`AX_CODE_DESKTOP_` prefix or `openchamber` directory name for compatibility with
existing installations. Treat those as legacy compatibility names, not product
branding.

## External AX Code Server

Use these when AX Code is already running elsewhere:

```bash
AX_CODE_PORT=4096 AX_CODE_SKIP_START=true ax-code-desktop
AX_CODE_HOST=https://myhost:4096 AX_CODE_SKIP_START=true ax-code-desktop
```

| Variable | Description |
| --- | --- |
| `AX_CODE_HOST` | Full base URL of an external AX Code server. Takes precedence over `AX_CODE_PORT`. |
| `AX_CODE_PORT` | Port of an external local AX Code server. |
| `AX_CODE_SKIP_START` | Set to `true` to prevent AX Code Desktop from starting its own AX Code server. |
| `AX_CODE_DESKTOP_AX_CODE_HOSTNAME` | Legacy-prefixed bind hostname for the managed AX Code server. |
| `AX_CODE_DESKTOP_HOST` | Legacy-prefixed bind hostname for the AX Code Desktop web server. |

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

For container or operator-managed deployments, mount persistent storage for the
legacy app data path, AX Code config, and SSH material:

```bash
mkdir -p data/openchamber data/ax-code/share data/ax-code/config data/ssh
chown -R 1000:1000 data/
```

The `data/openchamber` path is retained for compatibility.

## License

MIT. This package is part of AX Code Desktop and follows the repository-level
license and provenance notice in [../../NOTICE](../../NOTICE).
