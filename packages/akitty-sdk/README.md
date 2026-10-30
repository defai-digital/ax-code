# AkiTTY SDK snapshot

This private workspace wrapper consumes the compiled `@ax-code/akitty-sdk` 0.1.0
package from the AkiTTY repository. `vendor/` retains the exact packed ESM,
declarations, original manifest, README and MIT license. SDK implementation changes
belong in AkiTTY; this wrapper changes only workspace resolution and verification.

`SOURCE.json` records the source revision, packed archive SHA-256, source hashes
and installed file hashes. AX Code builds without an AkiTTY checkout or registry
credentials. The SDK bundles into the CLI as ordinary JavaScript, with no native
library or FFI dependency.

```sh
node script/verify-akitty-sdk.mjs
node script/verify-akitty-sdk.mjs --source ../akitty
```

Update by building and packing the canonical SDK at a committed revision, replacing
the five files in `vendor/` byte for byte, updating the receipt and wrapper version,
then running the verifier and AX Code TUI checks. Do not edit vendored runtime files.
