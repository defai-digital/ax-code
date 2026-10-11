# Release Verification

Status: Active
Scope: public, current-state
Last reviewed: 2026-08-21
Owner: AX Code release engineering

[`ax-minisign.pub`](ax-minisign.pub) is the canonical public key for AX Code release signatures. Installers, release
workflows, and publishing scripts read this checked-in copy. The public download origin
also publishes the same key, and the website hosts it at
[ax-code.app/docs-assets/release/ax-minisign.pub](https://ax-code.app/docs-assets/release/ax-minisign.pub).
No source checkout is needed to verify an artifact with the pinned key below.

To verify a downloaded asset and its detached signature:

```bash
minisign -V \
  -P 'RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO' \
  -m ax-code-darwin-arm64.zip \
  -x ax-code-darwin-arm64.zip.minisig
```

On Windows (PowerShell), the same public key verifies CLI archives and the installer script:

```powershell
# From a checkout, or use the key string from SECURITY.md / install.ps1
minisign -V -p docs/release/ax-minisign.pub -m ax-code-windows-x64.zip -x ax-code-windows-x64.zip.minisig
minisign -V -p docs/release/ax-minisign.pub -m install.ps1 -x install.ps1.minisig

# Inline key form (matches what install.ps1 uses)
$minisign = "RWSlDu++afxCz01OqhYWhfo8+L8pVbSYXJBEb2zoWBuK0WACIzbGVZRO"
minisign -Vm ax-code-windows-x64.zip -x ax-code-windows-x64.zip.minisig -P $minisign
```

The Bash and PowerShell installers fail closed when verification fails. When `minisign` is not already on
PATH, they download the pinned minisign 0.12 archives from `download.ax-code.com`, check the archive
SHA-256, and check the extracted executable again before caching it, unless `AX_CODE_SKIP_MINISIGN_VERIFY=1`
is set intentionally. A `minisign` binary already on PATH is the operator's tool and is not re-hashed.

Treat a key mismatch or failed signature as a release-integrity failure. Do not replace the key without updating the
release workflows, installer verification, and key-rotation guidance in the same change.

See [Installation and Runtime Channels](../getting-started/install-runtime.md) for supported distribution channels.

## Rollback

If a published stable release must be withdrawn, follow the
[release rollback runbook](rollback.md).

## Release notes

CLI/TUI releases are documented here and in the repository [changelog](../../CHANGELOG.md). Desktop application
changes are owned by the separate AX Coder project.

- [AX Code v7.7.6](notes-v7.7.6.md)
- [AX Code v7.2.0](notes-v7.2.0.md)

Windows distributions support AMD64 (x64) only starting with v7.24.6. Earlier signed Windows ARM64 artifacts remain immutable. The [release platform policy](platforms.json) defines the version boundary and required archive inventory: 15 required distribution assets from v7.24.6, compared with 17 for earlier releases. Linux arm64 and Apple Silicon macOS remain supported.
