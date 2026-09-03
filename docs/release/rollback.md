# Release Rollback Runbook

Status: Active
Scope: public, current-state
Last reviewed: 2026-09-03
Owner: AX Code release engineering

This runbook describes how to withdraw a published **stable** (`latest` channel) AX Code CLI
release and restore the previous one. Prerelease (`beta` channel) releases do not touch the
Homebrew tap or winget, so rolling them back only requires the GitHub release step below.

Prefer **hotfix forward** (ship `vX.Y.Z+1`) for functional bugs. Roll back only for release-
integrity failures: broken or mis-signed artifacts, a corrupted installer, a channel/tag mistake
(for example a prerelease tag published to `latest`), or a severe regression with no quick fix.

## 1. Freeze the channel

Pause further releases and `postpublish_only` resumes until the rollback completes. The release
workflow refuses to replace assets on an already-published release, so no concurrent rerun can
overwrite the state being rolled back.

## 2. Re-point the GitHub release

Mark the bad release as a prerelease so `latest` resolves to the previous tag, and restore the
previous release notes if they were overwritten:

```bash
gh release edit "vX.Y.Z" --repo defai-digital/ax-code --prerelease
gh release edit "vX.Y.(Z-1)" --repo defai-digital/ax-code --latest
```

If the bad release's assets are corrupt or mis-signed, also delete them so no installer can
fetch them:

```bash
gh release delete-asset "vX.Y.Z" "<asset-name>" --repo defai-digital/ax-code
```

Do **not** delete the release object itself until its artifacts have been investigated; the
signed assets and workflow logs are the evidence for the postmortem.

## 3. Revert the Homebrew tap

`bash .github/scripts/update-homebrew.sh` pushed a formula commit to the shared
`defai-digital/homebrew-tap` repository (and the legacy product tap). Revert those commits in
both taps so `brew upgrade ax-code` serves the previous version again:

```bash
git -C homebrew-tap revert --no-edit <formula-commit>
```

Verify convergence afterward with the Homebrew smoke job
(`.github/workflows/install-matrix-smoke.yml`) against the restored version.

## 4. Revert winget manifests

Winget manifests are maintainer-submitted to `microsoft/winget-pkgs` from the manifests ZIP
attached to the GitHub release. If the bad version was already accepted, open a PR reverting
those manifest files. If it is still in review, close the PR. The `--clobber` upload on the
release only replaces the attached ZIP, never the published package.

## 5. Communicate

Post a short note in the release discussion and any support channel: affected versions, the
restored version, and reinstall instructions:

- Homebrew: `brew update && brew upgrade ax-code` (or `brew uninstall ax-code && brew install ax-code`).
- Windows/other: re-run the pinned installer from the previous release page; the installer
  fails closed on signature mismatch and bootstraps a pinned, SHA-256-checked `minisign`.

## 6. Verify the restored state

1. Confirm the GitHub `latest` release points at the previous tag and every asset verifies:

   ```bash
   gh release download "vX.Y.(Z-1)" --repo defai-digital/ax-code -p '*.zip' -p '*.minisig'
   minisign -V -p docs/release/ax-minisign.pub -m ax-code-darwin-arm64.zip -x ax-code-darwin-arm64.zip.minisig
   ```

2. Confirm the Homebrew formula serves the restored version and installs cleanly on a
   clean runner (the install-matrix smoke workflow does this).
3. Confirm `ax-code --version` on a fresh install reports the restored version and passes
   `ax-code doctor`.

## 7. Postmortem

Record what passed the release gates yet still shipped broken, and file fixes against
`.github/workflows/release.yml` (validation, smoke coverage) before the next release. Update
this runbook if any step did not work as written.
