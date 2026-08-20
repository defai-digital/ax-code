# Upstream provenance

`@ax-code/tui` is an AX-owned package containing a derived renderer snapshot originally published by the OpenTUI
project under the MIT license. Public package identity, release staging, patches, and product integration are maintained
by AX Code; derivation and copyright notices remain intact.

## Pinned native baseline

The authoritative native record is [`vendor/manifest.json`](./vendor/manifest.json). It records:

- upstream version and repository;
- retrieval timestamp;
- platform package and target metadata;
- registry integrity;
- native library size and SHA-256; and
- license hash.

JavaScript/declaration artifacts and native libraries must be refreshed together unless ABI compatibility is proven by
the packed Node distribution and renderer test suite. A package consolidation must never be used as an implicit upstream
version upgrade.

## Refresh policy

1. Pin the exact upstream source/package/native version.
2. Fetch native artifacts through `pnpm vendor:tui-native`.
3. Apply AX divergences through `pnpm apply:tui-patches`.
4. Run all checks listed in `MAINTENANCE.md`.
5. Update the manifest, this record when necessary, and `DIVERGENCES.md` in the same change.
