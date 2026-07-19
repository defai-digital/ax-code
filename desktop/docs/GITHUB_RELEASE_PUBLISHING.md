# GitHub release publishing

Use the guarded publish script from the AX Code monorepo root:

```bash
pnpm run release:desktop -- --version 0.8.0
```

Before running it, bump the package versions, add the matching
`CHANGELOG.md` section, and commit those changes. The script intentionally does
not edit source files during publishing; it validates that the prepared release
commit is safe to tag.

That first run is a dry-run preflight. It validates package versions,
`CHANGELOG.md`, Git state, GitHub authentication, docs, tests, type-checking,
linting, and build output. It does not create a tag or mutate GitHub.

When the dry run passes, publish:

```bash
pnpm run release:desktop -- --version 0.8.0 --publish
```

The publish path:

1. Verifies the worktree is clean and `HEAD` matches the release branch on
   `origin`.
2. Verifies the local and remote `desktop-v<version>` tag do not already exist.
3. Verifies the GitHub Release does not already exist.
4. Runs `pnpm run docs:validate`, `pnpm run test`, `pnpm run type-check`,
   `pnpm run lint`, and `pnpm run build`.
5. Creates and pushes the annotated `desktop-v<version>` tag.
6. Waits for `.github/workflows/desktop-release.yml` to finish.
7. The workflow signs each release asset with `desktop/scripts/minisign-artifacts.sh`
   using the shared `AX_CODE_MINISIGN_SECRET_KEY_B64` and
   `AX_CODE_MINISIGN_PASSWORD` GitHub Actions secrets (with the legacy
   `AX_CODE_DESKTOP_MINISIGN_*` names as fallbacks).
8. The workflow uploads the generated `.minisig` files and canonical
   `docs/release/ax-minisign.pub` key.
9. A separate job re-downloads the draft assets, requires signature coverage,
   and verifies every Minisign signature against that committed key.
10. The workflow publishes the release only after those checks pass.

If the GitHub workflow succeeded before signatures were uploaded, or you need
to repair signature assets manually, rerun only the local signature upload step:

```bash
pnpm run release:desktop -- --version 0.8.0 --signatures-only --publish
```

On macOS, the local repair path can read the minisign passphrase from Apple
Keychain when `AX_CODE_DESKTOP_MINISIGN_PASSWORD` is not set. See
`docs/MINISIGN.md` for the Keychain item names.

Local macOS packaging defaults to the `ax-notary` notarytool Keychain profile
and Developer team `N5ZUZDUJS6`. Store the Apple ID credentials once with
`xcrun notarytool store-credentials ax-notary`; the packaging process passes
only the profile name to electron-builder and does not read or commit the
app-specific password. Set `APPLE_KEYCHAIN_PROFILE` to another profile to
override it, or set it to an empty value to keep an ad hoc local package
unnotarized. GitHub Actions continues to use its explicit App Store Connect API
key secrets.

Use `--skip-signing` only for emergency releases where detached minisign
signatures are intentionally not being published. Use `--skip-local-validation`
only after the same validation commands have already passed on the exact commit
being tagged.

## Platform trust checklist

Before broad promotion, make the release notes explicit about native platform
trust:

- macOS: state whether artifacts are Developer ID signed and notarized, or
  whether users should expect Gatekeeper/manual quarantine remediation.
- Windows: state whether artifacts are Authenticode-signed and whether
  SmartScreen may show an unknown-publisher or low-reputation warning.
- minisign: confirm every downloadable artifact has a matching `.minisig` and
  that the pinned public key in `docs/MINISIGN.md` is still current.
- Scope: describe minisign as artifact-integrity verification only. It does not
  replace macOS notarization, Windows Authenticode, SmartScreen reputation, or
  Electron update signing.
- First launch: include user-facing first-run guidance for any expected
  Gatekeeper or SmartScreen warning.
