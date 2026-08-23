#!/usr/bin/env bash
# Stages the closed-source AX Computer release artifact (signed MCP server +
# Swift driver, built by script/build-release.sh in the ax-computer repo) into
# packages/electron/resources/ax-computer so electron-builder can bundle it as
# an extraResource (see electron-builder.yml).
#
# Source: AX_COMPUTER_DIST, defaulting to the local ax-computer build output.
# When the artifact is absent (OSS/dev builds), stages a README.txt placeholder
# instead so the extraResources "from" path always exists and packaging never
# fails on a missing directory.
set -euo pipefail

electron_dir="$(cd "$(dirname "$0")/.." && pwd)"
src="${AX_COMPUTER_DIST:-$HOME/code/ax-computer/dist/ax-computer-0.1.0-darwin-arm64}"
dest="$electron_dir/resources/ax-computer"

rm -rf "$dest"
mkdir -p "$dest"

if [ -d "$src" ]; then
  cp -R "$src"/. "$dest"/
  echo "[electron] ax-computer server → resources/ax-computer (from $src)"
else
  cat > "$dest/README.txt" <<'EOF'
The AX Computer computer-use server is not bundled in this build.

Desktop release builds stage the signed ax-computer release artifact here via
scripts/stage-ax-computer.sh. Set AX_COMPUTER_DIST to a release artifact
directory from the (closed-source) ax-computer repo to bundle it.
EOF
  echo "[electron] ax-computer artifact not found at $src — staged README.txt placeholder"
fi
