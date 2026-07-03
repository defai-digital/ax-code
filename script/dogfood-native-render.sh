#!/usr/bin/env bash
# ADR-046 dogfooding launcher — run the installed `ax-code` CLI with the Rust
# native render core engaged (AX_CODE_NATIVE_RENDER=1, full render pipeline).
#
# Usage:
#   script/dogfood-native-render.sh [--rebuild] [--yoga] [--smoke] [-- <args>]
#
#   --rebuild   Rebuild the @ax-code/render addon AND the bundled dist launcher
#               (setup:cli --rebuild) before launching. Do this after changing
#               the Rust crate or the opentui-core overlay.
#   --yoga      Escape hatch: route only the yoga/audio families to Rust and
#               keep the render pipeline on the bundled Zig library
#               (AX_CODE_NATIVE_RENDER_SCOPE=yoga). Use to A/B a suspected
#               render-core parity gap.
#   --smoke     Non-interactive verification instead of launching the TUI:
#               the launcher boots, the Rust addon loads with no fallback, and
#               the render family routes to the expected backend (RUST by
#               default, ZIG under --yoga). Exits non-zero on any failure — good
#               after a --rebuild.
#   --          Everything after is forwarded to `ax-code`.
#
# The launcher shim and any stale dist processes hold the PREVIOUS build's code,
# so they are killed before an interactive launch (a known gotcha after
# --rebuild). --smoke is non-destructive and does not kill anything.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

rebuild=0
smoke=0
scope="full"
declare -a passthrough=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) rebuild=1; shift ;;
    --yoga) scope="yoga"; shift ;;
    --smoke) smoke=1; shift ;;
    --) shift; passthrough=("$@"); break ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

# First built dist tree whose bundled node exists (platform-specific dir name).
find_dist_dir() {
  local d
  for d in "$REPO_ROOT"/packages/ax-code/dist/ax-code-*; do
    [[ -x "$d/node/bin/node" ]] && { echo "$d"; return 0; }
  done
  return 1
}

run_smoke() {
  local fail=0

  echo "==> Smoke: launcher boots (ax-code --version)"
  local ver
  if ver="$(ax-code --version 2>/dev/null)" && [[ -n "$ver" ]]; then
    echo "    ok: $ver"
  else
    echo "    FAIL: ax-code --version printed nothing"; fail=1
  fi

  echo "==> Smoke: flagged boot has no addon load failure"
  local out
  out="$(AX_CODE_NATIVE_RENDER=1 ax-code --version 2>&1 || true)"
  if grep -qiE "failed to load|falling back" <<<"$out"; then
    echo "    FAIL: the Rust addon fell back to Zig:"
    grep -iE "failed to load|falling back" <<<"$out" | sed 's/^/      /'
    fail=1
  else
    echo "    ok: no fallback warning"
  fi

  echo "==> Smoke: render family routes to the expected backend (scope: $scope)"
  local dist
  if dist="$(find_dist_dir)"; then
    # getBuildOptions is a Rust no-op (buffer stays intact) but Zig populates it,
    # so it distinguishes which backend the render family is routed to. Run it
    # through the SHIPPED bundled node + dist opentui-core.
    local fp="$dist/node_modules/.ax-smoke-fp.mjs"
    cat > "$fp" <<'FP'
import { createRequire } from "node:module"
const require = createRequire(import.meta.url)
const ffi = require("node:ffi")
const { resolveRenderLib } = await import("@ax-code/opentui-core")
const sym = resolveRenderLib().opentui.symbols
const buf = new Uint8Array(64).fill(0xAB)
const p = ffi.getRawPointer(buf)
sym.getBuildOptions(typeof p === "bigint" ? Number(p) : p)
console.log(buf.every((b) => b === 0xAB) ? "RUST" : "ZIG")
FP
    local expected="RUST"
    local -a envs=(AX_CODE_NATIVE_RENDER=1)
    if [[ "$scope" == "yoga" ]]; then
      expected="ZIG"
      envs+=(AX_CODE_NATIVE_RENDER_SCOPE=yoga)
    fi
    local got
    got="$(env "${envs[@]}" "$dist/node/bin/node" --experimental-ffi \
      --disable-warning=ExperimentalWarning "$fp" 2>/dev/null | tail -1)"
    rm -f "$fp"
    if [[ "$got" == "$expected" ]]; then
      echo "    ok: render family => $got"
    else
      echo "    FAIL: expected $expected, got '${got:-<none>}'"; fail=1
    fi
  else
    echo "    SKIP: no built dist found — run with --rebuild"
  fi

  if [[ "$fail" == "0" ]]; then
    echo "==> Smoke PASSED"
    return 0
  fi
  echo "==> Smoke FAILED"
  return 1
}

if [[ "$rebuild" == "1" ]]; then
  echo "==> Building @ax-code/render addon"
  pnpm run build:native render
  echo "==> Rebuilding bundled dist + launcher (setup:cli --rebuild)"
  pnpm run setup:cli -- --rebuild
fi

if ! command -v ax-code >/dev/null 2>&1; then
  echo "ax-code launcher not found on PATH. Run: pnpm run setup:cli -- --rebuild" >&2
  exit 1
fi

# --smoke is a non-destructive check: verify and exit without killing anything
# or launching the interactive TUI.
if [[ "$smoke" == "1" ]]; then
  run_smoke
  exit $?
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

echo "==> Launching ax-code with the Rust render core (scope: $scope)"
export AX_CODE_NATIVE_RENDER=1
if [[ "$scope" == "yoga" ]]; then
  export AX_CODE_NATIVE_RENDER_SCOPE=yoga
fi
exec ax-code "${passthrough[@]}"
