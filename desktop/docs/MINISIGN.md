# Minisign release signing

This project publishes detached minisign signatures for GitHub Release assets.
The release workflow signs assets before the draft release is published, and
manual downloads can be verified against the pinned AX Code Desktop release
public key.

Pinned public key:

```text
RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A
```

The signing key lives outside the repository in `~/signkey` by default for
local recovery workflows. In CI, the secret key is provided through GitHub
Actions secrets.

## Key files

Default paths:

```text
~/signkey/ax-code-desktop.minisign.key
~/signkey/ax-code-desktop.minisign.pub
```

The secret key must never be committed, logged, or uploaded as a release asset.
The public key is safe to publish so users can verify downloaded artifacts.
`desktop/scripts/minisign-artifacts.sh` refuses to sign or verify with a public key that
does not match the pinned release key.

## Generate the keypair

Run this from the repository root:

```bash
desktop/scripts/minisign-keygen.sh
```

`minisign` prompts for a password and writes the keypair to `~/signkey`.
The script sets the directory to mode `700`, the secret key to `600`, and the
public key to `644`.

For production release signing, the generated public key must match the pinned
key above. If you intentionally rotate the release key, update the pinned key in
`desktop/scripts/minisign-artifacts.sh`, `.github/workflows/desktop-release.yml`,
`README.md`, and this document in the same change that updates the GitHub
Actions secret.

To use a different directory:

```bash
desktop/scripts/minisign-keygen.sh --key-dir /path/to/signkey
```

An unencrypted key can be generated with `--no-password`, but that should only
be used for short-lived local testing keys. Prefer the explicit alias
`--allow-unencrypted-test-key` so the intent is clear in command history.

## Sign release artifacts

After building or packaging the app locally, run:

```bash
desktop/scripts/minisign-artifacts.sh
```

With no file arguments, the script signs conventional release outputs under
`desktop/packages/electron/dist` and `desktop/packages/web`. It creates one `<artifact>.minisig`
file per artifact and verifies each signature against the pinned public key.

The script refuses to overwrite an existing `.minisig` file. Use `--force` only
when you intentionally want to replace signatures after rebuilding or rotating
the key.

To sign explicit files:

```bash
desktop/scripts/minisign-artifacts.sh desktop/packages/electron/dist/AX-Code-0.8.0-mac-arm64.dmg
```

To use a different key directory:

```bash
desktop/scripts/minisign-artifacts.sh --key-dir /path/to/signkey
```

By default, each trusted minisign comment includes the artifact basename,
SHA-256 hash, and UTC signing timestamp. Override it only when a release process
needs a fixed trusted comment:

```bash
desktop/scripts/minisign-artifacts.sh --trusted-comment "AX Code Desktop 0.8.0 release"
```

### Pin the release public key

The desktop release public key is pinned in `desktop/scripts/minisign-artifacts.sh` and
**enforced by default** — the signer fails closed if the local keypair does not
match it. This prevents a rotated, wrong, or planted key from silently producing
valid-looking signatures.

Override the expected key (for example, during a deliberate rotation) with an
env var or a flag:

```bash
AX_CODE_DESKTOP_MINISIGN_PINNED_PUBLIC_KEY='RWS...' desktop/scripts/minisign-artifacts.sh ...
# or
desktop/scripts/minisign-artifacts.sh --pinned-public-key 'RWS...'
```

### Verify without a public key file

To sign and verify when only the public key *string* is available (no `.pub`
file on disk), pass it explicitly. Pin enforcement then compares the string
directly, and verification uses `minisign -P`:

```bash
desktop/scripts/minisign-artifacts.sh --public-key-string 'RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A' ...
```

### Write signatures to a separate directory

Collect all `.minisig` outputs into one directory instead of beside each
artifact (useful when collecting signatures for upload):

```bash
desktop/scripts/minisign-artifacts.sh --signature-dir ./signatures ...
```

### Other signing options

```text
--key-dir <path>          Directory containing keys (default: ~/signkey)
--secret-key <path>       Secret key path
--public-key <path>       Public key path
--public-key-string <key> Verify with a raw public key string (no file needed)
--pinned-public-key <key> Fail unless the public key matches this key
--signature-dir <dir>     Write all .minisig files into this directory
--trusted-comment <text>  Trusted minisign comment
--untrusted-comment <text> Untrusted minisign comment
--keychain-service <svc>  macOS Keychain service name (default: ax-code-desktop-minisign)
--keychain-account <acct> macOS Keychain account name (default: ax-code-desktop-release)
--force                   Replace existing .minisig files
--no-verify               Skip verification after signing
--dry-run                 Print what would be signed
```

## Verify an artifact

Users can verify a downloaded artifact with the pinned public key:

```bash
minisign -V \
  -P RWS+dNbWPLZ6W9TH486c9zdH84NiiuFnm4VpVTRlXoMHClyQx/fY7W2A \
  -m desktop/packages/electron/dist/AX-Code-0.8.0-mac-arm64.dmg \
  -x desktop/packages/electron/dist/AX-Code-0.8.0-mac-arm64.dmg.minisig
```

## GitHub Actions secrets

The release workflow requires these repository secrets before a release can be
published:

```text
AX_CODE_DESKTOP_MINISIGN_SECRET_KEY_B64
AX_CODE_DESKTOP_MINISIGN_PASSWORD
```

`AX_CODE_DESKTOP_MINISIGN_SECRET_KEY_B64` is the base64-encoded minisign secret
key file that matches the pinned public key. `AX_CODE_DESKTOP_MINISIGN_PASSWORD`
unlocks that key during the signing job.

## macOS Keychain for local signing

For local release recovery on macOS, keep the encrypted minisign secret key on
disk with mode `600` and store only its passphrase in Apple Keychain:

```bash
security add-generic-password -U \
  -a ax-code-desktop-release \
  -s ax-code-desktop-minisign \
  -w
```

`desktop/scripts/minisign-artifacts.sh` reads that Keychain item automatically when
`AX_CODE_DESKTOP_MINISIGN_PASSWORD` and `MINISIGN_PASSWORD` are not set. The
password resolution order is:

```text
AX_CODE_DESKTOP_MINISIGN_PASSWORD  >  MINISIGN_PASSWORD  >  macOS Keychain  >  interactive prompt
```

Override the Keychain lookup names with `AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_SERVICE`
/ `AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_ACCOUNT` env vars or the
`--keychain-service` / `--keychain-account` flags:

```text
AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_SERVICE
AX_CODE_DESKTOP_MINISIGN_KEYCHAIN_ACCOUNT
```

This minisign signature is separate from platform code signing and notarization.
It proves artifact integrity against the published minisign public key; it does
not replace Apple Developer ID, Windows Authenticode, or Electron auto-update
metadata.
