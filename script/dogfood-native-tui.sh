#!/usr/bin/env bash
# Dogfood launcher for the standalone native Rust/Ratatui TUI.
#
# Zig/OpenTUI remains the production default. This script builds/tests the
# Ratatui sidecar and launches AX Code with AX_CODE_TUI_ENGINE=native.
#
# Usage:
#   script/dogfood-native-tui.sh [--rebuild] [--smoke] [-- <ax-code args>]

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

rebuild=0
smoke=0
declare -a passthrough=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) rebuild=1; shift ;;
    --smoke) smoke=1; shift ;;
    --yoga)
      echo "--yoga was removed; native is now a separate Rust/Ratatui UI." >&2
      exit 2
      ;;
    --) shift; passthrough=("$@"); break ;;
    *) passthrough+=("$1"); shift ;;
  esac
done

if [[ "$rebuild" == "1" ]]; then
  echo "==> Building native Rust TUI"
  cargo build --manifest-path crates/Cargo.toml -p ax-code-tui --release
  echo "==> Rebuilding bundled distribution and launcher"
  pnpm run setup:cli -- --rebuild
fi

if [[ "$smoke" == "1" ]]; then
  echo "==> Checking native Rust TUI"
  cargo test --manifest-path crates/Cargo.toml -p ax-code-tui
  cargo build --manifest-path crates/Cargo.toml -p ax-code-tui
  crates/target/debug/ax-code-tui --help >/dev/null
  echo "==> Native TUI smoke passed"
  exit 0
fi

if ! command -v ax-code >/dev/null 2>&1; then
  echo "ax-code launcher not found on PATH. Run: pnpm run setup:cli -- --rebuild" >&2
  exit 1
fi

echo "==> Launching standalone Rust/Ratatui UI (Zig remains the default)"
export AX_CODE_TUI_ENGINE=native
exec ax-code "${passthrough[@]}"
