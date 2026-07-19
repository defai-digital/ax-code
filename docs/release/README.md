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

Treat a key mismatch or failed signature as a release-integrity failure. Do not replace the key without updating the
release workflows, installer verification, and key-rotation guidance in the same change.

See [Installation and Runtime Channels](../getting-started/install-runtime.md) for supported distribution channels.
