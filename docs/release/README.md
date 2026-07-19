# Release Verification

Status: Active
Scope: public, current-state
Last reviewed: 2026-07-19
Owner: AX Code release engineering

[`ax-minisign.pub`](ax-minisign.pub) is the canonical public key for AX Code release signatures. Installers, release
workflows, and publishing scripts read this checked-in copy; GitHub releases also publish the same key as an asset.

To verify a downloaded asset and its detached signature:

```bash
minisign -V \
  -p docs/release/ax-minisign.pub \
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
minisign -Vm ax-code-windows-arm64.zip -x ax-code-windows-arm64.zip.minisig -P $minisign
```

The Bash and PowerShell installers both fail closed when `minisign` is missing or verification fails, unless
`AX_CODE_SKIP_MINISIGN_VERIFY=1` is set intentionally.

Treat a key mismatch or failed signature as a release-integrity failure. Do not replace the key without updating the
release workflows, installer verification, and key-rotation guidance in the same change.

See [Installation and Runtime Channels](../getting-started/install-runtime.md) for supported distribution channels.
