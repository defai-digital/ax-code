#!/usr/bin/env bash
# ADR-046 dogfooding launcher — run the installed `ax-code` CLI with the Rust
# native render core engaged (AX_CODE_NATIVE_RENDER=1, full render pipeline).
#
# Usage:
#   script/dogfood-native-render.sh [--rebuild] [--yoga] [-- <ax-code args>]
#
#   --rebuild   Rebuild the @ax-code/render addon AND the bundled dist launcher
#               (setup:cli --rebuild) before launching. Do this after changing
#               the Rust crate or the opentui-core overlay.
#   --yoga      Escape hatch: route only the yoga/audio families to Rust and
#               keep the render pipeline on the bundled Zig library
#               (AX_CODE_NATIVE_RENDER_SCOPE=yoga). Use to A/B a suspected
#               render-core parity gap.
#   --          Everything after is forwarded to `ax-code`.
#
# The launcher shim and any stale dist processes hold the PREVIOUS build's code,
# so they are killed before launch (a known gotcha after --rebuild).

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

rebuild=0
scope="full"
declare -a passthrough=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) rebuild=1; shift ;;
    --yoga) scope="yoga"; shift ;;
    --) shift; passthrough=("$@"); break ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

if [[ "$rebuild" == "1" ]]; then
  echo "==> Building @ax-code/render addon"
  pnpm run build:native render
  echo "==> Rebuilding bundled dist + launcher (setup:cli --rebuild)"
  pnpm run setup:cli -- --rebuild
fi

# Kill stale dist processes so the fresh build is what runs. The pattern targets
# only the ax-code entrypoint (index-node-tui.js: TUI, serve, tui-backend) — NOT
# language servers or other tools that merely run via the bundled node binary.
stale_pattern='dist/ax-code-.*index-node-tui'
if pgrep -f "$stale_pattern" >/dev/null 2>&1; then
  echo "==> Killing stale ax-code dist processes (they hold old code)"
  pkill -f "$stale_pattern" || true
  sleep 1
fi

if ! command -v ax-code >/dev/null 2>&1; then
  echo "ax-code launcher not found on PATH. Run: pnpm run setup:cli -- --rebuild" >&2
  exit 1
fi

echo "==> Launching ax-code with the Rust render core (scope: $scope)"
export AX_CODE_NATIVE_RENDER=1
if [[ "$scope" == "yoga" ]]; then
  export AX_CODE_NATIVE_RENDER_SCOPE=yoga
fi
exec ax-code "${passthrough[@]}"
