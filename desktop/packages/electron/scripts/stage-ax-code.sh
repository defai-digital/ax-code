#!/usr/bin/env bash
# Stages the pinned ax-code CLI runtime into resources/ax-code so
# electron-builder can bundle it as an extraResource (see electron-builder.yml).
#
# The pin is the Desktop app version itself (desktop/packages/electron
# package.json#version); the runtime tree is downloaded from the sibling
# v<version> CLI GitHub release and verified with the repo's minisign public
# key before extraction. Release builds (AX_CODE_STAGE_REQUIRED=true) fail
# closed: a missing archive or bad signature aborts packaging — never ship a
# runtime-less installer. Local builds can copy a prebuilt CLI dist tree via
# AX_CODE_DIST; with no artifact and no release requirement a README.txt
# placeholder keeps electron-builder's extraResources path valid.
set -euo pipefail

electron_dir="$(cd "$(dirname "$0")/.." && pwd)"
monorepo_root="$(cd "$electron_dir/../../.." && pwd)"
dest="$electron_dir/resources/ax-code"
pub_key="$monorepo_root/docs/release/ax-minisign.pub"
helpers="$electron_dir/scripts/stage-ax-code.mjs"

# Git Bash on Windows reports POSIX paths (/c/...), which node.exe cannot
# resolve. cygpath -m converts to a mixed Windows path (C:/...) that node
# accepts for module entry points.
node_helpers="$helpers"
if command -v cygpath >/dev/null 2>&1; then
  node_helpers="$(cygpath -m "$helpers")"
fi

# resolveStageTarget derives the packaging target from the electron-builder
# flags forwarded by package.mjs ($@).
plan="$(node "$node_helpers" plan "$@")"
plan_value() { printf '%s\n' "$plan" | sed -n "s/^$1=//p"; }
version="$(plan_value version)"
asset="$(plan_value asset)"
platform="$(plan_value platform)"
archive_url="$(plan_value archive_url)"
signature_url="$(plan_value signature_url)"
launcher="$(plan_value launcher)"
required="$(plan_value required)"

stage_placeholder() {
  local reason="$1"
  if [ "$required" = "true" ]; then
    echo "[stage-ax-code] $reason; AX_CODE_STAGE_REQUIRED=true — refusing to package without the bundled runtime" >&2
    exit 1
  fi
  rm -rf "$dest"
  # Keep an empty node_modules source directory for electron-builder's
  # dedicated dependency FileSet. Release trees replace it with real modules.
  mkdir -p "$dest/node_modules"
  node "$node_helpers" placeholder > "$dest/README.txt"
  echo "[stage-ax-code] $reason — staged README.txt placeholder"
  exit 0
}

# The staged tree is usable only when the launcher exists; on non-Windows
# targets it must also be executable (a broken exec bit would mask a broken
# bundled runtime). Windows .cmd launchers are existence-only.
launcher_usable() {
  if [ ! -f "$dest/$launcher" ]; then
    return 1
  fi
  if [ "$platform" != "win32" ] && [ ! -x "$dest/$launcher" ]; then
    return 1
  fi
  return 0
}

# Release archives can contain workspace-only symlinks left by pnpm deploy.
# They cannot resolve on an end-user machine, and macOS rejects links whose
# final destination escapes the signed app bundle.
sanitize_staged_tree() {
  if ! node "$node_helpers" sanitize-symlinks; then
    stage_placeholder "failed to sanitize unsafe runtime symlinks"
  fi
}

rm -rf "$dest"
mkdir -p "$dest"

# Local override: copy a prebuilt CLI dist tree directly (developer flow).
# Release builds must stage the minisign-verified release archive — refuse to
# let a leftover AX_CODE_DIST bypass verification and the fail-closed policy.
if [ -n "${AX_CODE_DIST:-}" ]; then
  if [ "$required" = "true" ]; then
    echo "[stage-ax-code] AX_CODE_DIST is set but AX_CODE_STAGE_REQUIRED=true — release builds must stage the verified release archive; unset AX_CODE_DIST for local builds" >&2
    exit 1
  fi
  if [ ! -d "$AX_CODE_DIST" ]; then
    echo "[stage-ax-code] AX_CODE_DIST is not a directory: $AX_CODE_DIST" >&2
    exit 1
  fi
  cp -R "$AX_CODE_DIST"/. "$dest"/
  sanitize_staged_tree
  if ! launcher_usable; then
    stage_placeholder "AX_CODE_DIST tree at $AX_CODE_DIST has no usable launcher $launcher"
  fi
  echo "[stage-ax-code] ax-code runtime → resources/ax-code (from $AX_CODE_DIST)"
  exit 0
fi

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT
archive="$tmpdir/$asset"
signature="$archive.minisig"

if ! curl --fail --location --no-progress-meter --retry 6 --retry-all-errors --retry-delay 10 \
  --output "$archive" "$archive_url"; then
  stage_placeholder "CLI release archive not available: $archive_url"
fi
if ! curl --fail --location --no-progress-meter --retry 6 --retry-all-errors --retry-delay 10 \
  --output "$signature" "$signature_url"; then
  stage_placeholder "CLI release signature not available: $signature_url"
fi
if ! command -v minisign >/dev/null 2>&1; then
  stage_placeholder "minisign is not installed"
fi
if ! minisign -V -p "$pub_key" -m "$archive" -x "$signature"; then
  stage_placeholder "minisign verification failed for $asset"
fi

# Extraction runs guarded: a corrupt archive must degrade to the placeholder
# in dev builds (and fail closed via stage_placeholder in release builds)
# instead of aborting under set -e.
extract_archive() {
  case "$asset" in
    *.zip)
      if command -v unzip >/dev/null 2>&1; then
        unzip -q "$archive" -d "$dest"
      elif command -v powershell >/dev/null 2>&1 || command -v pwsh >/dev/null 2>&1; then
        # Git Bash fallback: Expand-Archive needs Windows-style paths.
        win_archive="$archive"
        win_dest="$dest"
        if command -v cygpath >/dev/null 2>&1; then
          win_archive="$(cygpath -w "$archive")"
          win_dest="$(cygpath -w "$dest")"
        fi
        ps_bin="powershell"
        command -v powershell >/dev/null 2>&1 || ps_bin="pwsh"
        "$ps_bin" -NoProfile -NonInteractive -Command \
          "Expand-Archive -LiteralPath '$win_archive' -DestinationPath '$win_dest' -Force"
      else
        stage_placeholder "no unzip-capable tool available to extract $asset"
      fi
      ;;
    *.tar.gz)
      # GNU/BSD tar both preserve exec bits from release tarballs.
      tar -xzf "$archive" -C "$dest"
      ;;
    *)
      stage_placeholder "unsupported archive format: $asset"
      ;;
  esac
}

if ! extract_archive; then
  stage_placeholder "failed to extract $asset"
fi

sanitize_staged_tree

# Zip archives do not preserve exec bits; restore them on unix launchers.
if [ -d "$dest/bin" ]; then
  chmod +x "$dest/bin/"* 2>/dev/null || true
fi
if [ -d "$dest/node/bin" ]; then
  chmod +x "$dest/node/bin/"* 2>/dev/null || true
fi

if ! launcher_usable; then
  stage_placeholder "staged tree launcher $launcher is missing or not executable"
fi

echo "[stage-ax-code] ax-code runtime v$version → resources/ax-code ($asset, minisign verified)"
