#!/usr/bin/env bash
#
# Test Release Build Script (Electron)
#
# Local smoke test for the desktop release build. Builds the web assets and the
# Electron main/preload/server bundle, rebuilds native modules against the
# Electron ABI, then runs electron-builder for the host (or requested) arch.
#
# Usage:
#   ./scripts/test-release-build.sh [arch] [--no-bundle] [--zip-only]
#     arch: aarch64 | arm64 | x86_64 | x64   (default: host arch)
#     --no-bundle: stop after building web assets and Electron bundles/native deps
#     --zip-only: on macOS, package only the zip target instead of dmg+zip
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DESKTOP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(git -C "$DESKTOP_ROOT" rev-parse --show-toplevel)"
cd "$REPO_ROOT"

ARCH_ARG=""
SKIP_PACKAGE=0
ZIP_ONLY=0

for arg in "$@"; do
  case "$arg" in
    aarch64|arm64|x86_64|x64)
      if [[ -n "$ARCH_ARG" ]]; then
        echo "Multiple arch arguments provided: '$ARCH_ARG' and '$arg'" >&2
        exit 1
      fi
      ARCH_ARG="$arg"
      ;;
    --no-bundle)
      SKIP_PACKAGE=1
      ;;
    --zip-only)
      ZIP_ONLY=1
      ;;
    *)
      echo "Unknown argument '$arg' (expected aarch64|arm64|x86_64|x64|--no-bundle|--zip-only)" >&2
      exit 1
      ;;
  esac
done

case "$ARCH_ARG" in
  aarch64|arm64) BUILDER_ARCH="--arm64" ;;
  x86_64|x64)    BUILDER_ARCH="--x64" ;;
  "")            BUILDER_ARCH="" ;;
esac

echo "==> Building web assets"
pnpm --filter ax-code-desktop run build

echo "==> Bundling + native rebuild (desktop/packages/electron)"
pnpm --filter @ax-code/electron run build

if [[ "$SKIP_PACKAGE" -eq 1 ]]; then
  echo "==> Skipping electron-builder packaging (--no-bundle)"
  echo "==> Done. Web assets and Electron bundles/native deps are ready."
  exit 0
fi

echo "==> Packaging with electron-builder ${BUILDER_ARCH:-(host arch)}"
case "$(uname -s)" in
  Darwin)
    if [[ "$ZIP_ONLY" -eq 1 ]]; then
      PLATFORM="--mac zip"
    else
      PLATFORM="--mac"
    fi
    ;;
  Linux)  PLATFORM="--linux" ;;
  *)      PLATFORM="--win" ;;
esac

# Run from desktop/packages/electron so electron-builder resolves package.json,
# electron-builder.yml, dist/, resources/, and build/ as the project root
# (matches the CI macOS/Windows jobs and scripts/package.mjs).
# shellcheck disable=SC2086
node ./desktop/packages/electron/scripts/package.mjs ${PLATFORM} ${BUILDER_ARCH} --publish=never

echo "==> Done. Artifacts in desktop/packages/electron/dist/"
