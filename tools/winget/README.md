# Winget package manifests (scaffolding)

This directory holds **manifest generators and templates** for publishing AX Code
to the [Windows Package Manager Community Repository](https://github.com/microsoft/winget-pkgs).

Winget is the recommended long-term Windows discovery channel. Until packages are
merged upstream, users install via:

```powershell
# CLI (no preinstalled minisign required — installer bootstraps a pinned binary)
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://github.com/defai-digital/ax-code/releases/latest/download/install.ps1 | iex"

# Desktop: download the Authenticode-signed NSIS installer from GitHub Releases
```

## Packages planned

| Package identifier           | Installer type                         | Arches        |
| ---------------------------- | -------------------------------------- | ------------- |
| `DEFAI.AXCode`               | Portable ZIP / nested install.ps1 flow | x64, arm64    |
| `DEFAI.AXCode.Desktop`       | NSIS exe (`AX-Code-*-win-*.exe`)      | x64, arm64    |

Publisher: **DEFAI Private Limited** (matches Authenticode `publisherName`).

## Generate manifests for a release

From the monorepo root, after a GitHub release exists:

```bash
pnpm exec tsx tools/winget/generate-manifests.ts --version 7.1.0 --out .tmp/winget
```

This downloads SHA-256 hashes for the Windows release assets and writes versioned
manifest folders ready for a PR against `microsoft/winget-pkgs`.

### Validate locally (Windows)

```powershell
winget validate --manifest .tmp\winget\manifests\d\DEFAI\AXCode\Desktop\<version>
winget install --manifest .tmp\winget\manifests\d\DEFAI\AXCode\Desktop\<version>
```

### Submit upstream

1. Fork [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).
2. Copy generated manifests under `manifests/d/DEFAI/...`.
3. Open a PR following the winget-pkgs contribution guide.
4. After merge, users can run:

```powershell
winget install DEFAI.AXCode
winget install DEFAI.AXCode.Desktop
```

## Release checklist (after each Desktop/CLI Windows release)

1. Tag/publish the GitHub release so `AX-Code-*-win-*.exe` and `ax-code-windows-*.zip` exist.
2. Generate manifests:  
   `pnpm exec tsx tools/winget/generate-manifests.ts --version <ver> --out .tmp/winget`
3. On Windows: `winget validate --manifest .tmp/winget/manifests/d/DEFAI/AXCode/<ver>`  
   and the Desktop sibling under `.../AXCode/Desktop/<ver>`.
4. Open a PR to `microsoft/winget-pkgs` with both package folders.
5. In release notes, mention SmartScreen publisher **DEFAI Private Limited** and NSIS silent `/S`.

## Notes

- Desktop auto-update continues to use electron-updater + GitHub Releases; winget
  upgrades are an additional discovery/update path for IT-managed machines.
- CLI manifests currently describe the GitHub ZIP assets. Prefer a future
  Authenticode-signed CLI bootstrapper for the cleanest winget UX.
- Keep package identifiers stable once published; only bump the version folder.
