# AX Code CLI winget manifests

This directory owns manifest generation for the `DEFAI.AXCode` portable CLI package. Desktop GUI manifests belong to
the separate AX Coder source repository.

Generate review-only manifests without downloading release assets:

```bash
pnpm run winget:generate -- --version 7.10.2 --package cli --skip-download
```

Omit `--skip-download` after the matching signed `v*` release assets exist. The stable CLI release workflow generates
and attaches the same manifests after publication.
