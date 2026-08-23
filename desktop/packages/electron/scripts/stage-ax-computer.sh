#!/usr/bin/env bash
# Stages the closed-source AX Computer release artifact (signed MCP server +
# Swift driver, built by script/build-release.sh in the ax-computer repo) into
# packages/electron/resources/ax-computer so electron-builder can bundle it as
# an extraResource (see electron-builder.yml).
#
# Computer use is intentionally unreleased throughout v7.x. The signed server
# may be staged only for v8+ package versions, using AX_COMPUTER_DIST or the
# default local ax-computer build output. Ineligible versions and builds with no
# artifact receive a README.txt placeholder so electron-builder's
# extraResources path always exists.
set -euo pipefail

electron_dir="$(cd "$(dirname "$0")/.." && pwd)"
src="${AX_COMPUTER_DIST:-$HOME/code/ax-computer/dist/ax-computer-0.1.0-darwin-arm64}"
dest="$electron_dir/resources/ax-computer"
# Git Bash on Windows reports POSIX paths (/c/...), which node.exe cannot
# resolve. cygpath -m converts to a mixed Windows path (C:/...) that stays
# valid inside the JS string literal below.
node_dir="$electron_dir"
if command -v cygpath >/dev/null 2>&1; then
  node_dir="$(cygpath -m "$electron_dir")"
fi
version="$(node -p "require('$node_dir/package.json').version")"
major="${version%%.*}"

if [[ ! "$major" =~ ^[0-9]+$ ]]; then
  echo "[electron] invalid package version for ax-computer release policy: $version" >&2
  exit 1
fi

rm -rf "$dest"
mkdir -p "$dest"

if (( major < 8 )); then
  cat > "$dest/README.txt" <<EOF
The AX Computer computer-use server is intentionally not bundled in AX Code
Desktop v$version. Computer use is unreleased throughout v7.x; v8.0.0 is the
earliest eligible release and still requires an explicit go/no-go decision.
EOF
  echo "[electron] ax-computer release deferred until v8.0.0 — staged README.txt placeholder"
elif [ -d "$src" ]; then
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
