/**
 * Source-launcher script generation.
 *
 * The developer-facing `pnpm setup:cli -- --source` command produces a shell
 * shim that re-execs ax-code from the source tree on Node (tsx + the AX Code TUI
 * Solid loader + node:ffi), matching `pnpm dev`. It cd's into the package so
 * bare module specifiers resolve, preserving the caller's directory in
 * AX_CODE_ORIGINAL_CWD for project detection.
 *
 * Keeping the generation in one place ensures the contributor launcher remains
 * consistent across Unix and Windows shims.
 */
import path from "path"

export type SourceLauncherInput = {
  /**
   * Repository or installation root containing `packages/ax-code`. For dev,
   * this is the checkout root.
   */
  root: string
  /** Generate the Windows .cmd variant when true; sh script otherwise. */
  windows?: boolean
}

// Note: the parentheses in the echoed text need caret-escaping inside the
// if-block, but the stderr redirect must NOT be escaped — `1^>^&2` prints a
// literal "1>&2" at the end of the warning (seen in issue #315's output)
// instead of redirecting.
export const WINDOWS_UTF8_WARNING = `for /f "tokens=2 delims=:" %%A in ('chcp') do set "AX_CODE_ACTIVE_CODEPAGE=%%A"
set "AX_CODE_ACTIVE_CODEPAGE=%AX_CODE_ACTIVE_CODEPAGE: =%"
if not "%AX_CODE_ACTIVE_CODEPAGE%"=="65001" (
  chcp 65001 >nul
  echo AX Code warning: switched terminal code page from %AX_CODE_ACTIVE_CODEPAGE% to UTF-8 ^(65001^) for TUI rendering. 1>&2
)
`

export function sourceLauncherScript(input: SourceLauncherInput): string {
  // Use platform-explicit path joiners so the generated script is correct
  // regardless of which host OS produced it (release pipelines build
  // Windows artifacts on Linux runners, dev tooling generates POSIX
  // shims from any host).
  const joiner = input.windows ? path.win32 : path.posix
  const root = input.windows ? input.root.replace(/\//g, "\\") : input.root.replace(/\\/g, "/")
  const cwdPath = joiner.join(root, "packages", "ax-code")
  const entry = joiner.join(root, "packages", "ax-code", "src", "index-node-tui.ts")
  const loader = joiner.join(root, "script", "solid-loader.mjs")
  const nodeFfiRunner = joiner.join(root, "script", "node-ffi-runner.mjs")
  if (input.windows) {
    return `@echo off
set "AX_CODE_SOURCE_CWD=${cwdPath}"
set "AX_CODE_SOURCE_ENTRY=${entry}"
set "AX_CODE_SOURCE_LOADER=${loader}"
set "AX_CODE_SOURCE_NODE_FFI_RUNNER=${nodeFfiRunner}"
if not exist "%AX_CODE_SOURCE_CWD%\\" (
  echo ax-code source launcher points at a missing checkout: %AX_CODE_SOURCE_CWD% 1>&2
  echo Install the packaged runtime instead: curl -fsSL -H "Accept: application/vnd.github.raw+json" "https://api.github.com/repos/defai-digital/ax-code/contents/install?ref=main" ^| bash 1>&2
  exit /b 127
)
if not exist "%AX_CODE_SOURCE_NODE_FFI_RUNNER%" (
  echo ax-code source launcher points at a missing node:ffi runner: %AX_CODE_SOURCE_NODE_FFI_RUNNER% 1>&2
  echo Reinstall the source launcher from the current checkout. 1>&2
  exit /b 127
)
set AX_CODE_ORIGINAL_CWD=%CD%
${WINDOWS_UTF8_WARNING}cd /d "%AX_CODE_SOURCE_CWD%"
node "%AX_CODE_SOURCE_NODE_FFI_RUNNER%" --import tsx --import "%AX_CODE_SOURCE_LOADER%" --conditions=node "%AX_CODE_SOURCE_ENTRY%" %*
`
  }
  return `#!/bin/sh
AX_CODE_SOURCE_CWD="${cwdPath}"
AX_CODE_SOURCE_ENTRY="${entry}"
AX_CODE_SOURCE_LOADER="${loader}"
AX_CODE_SOURCE_NODE_FFI_RUNNER="${nodeFfiRunner}"
if [ ! -d "$AX_CODE_SOURCE_CWD" ]; then
  echo "ax-code source launcher points at a missing checkout: $AX_CODE_SOURCE_CWD" >&2
  echo 'Install the packaged runtime instead: curl -fsSL -H "Accept: application/vnd.github.raw+json" "https://api.github.com/repos/defai-digital/ax-code/contents/install?ref=main" | bash' >&2
  exit 127
fi
if [ ! -f "$AX_CODE_SOURCE_NODE_FFI_RUNNER" ]; then
  echo "ax-code source launcher points at a missing node:ffi runner: $AX_CODE_SOURCE_NODE_FFI_RUNNER" >&2
  echo "Reinstall the source launcher from the current checkout." >&2
  exit 127
fi
export AX_CODE_ORIGINAL_CWD="\$(pwd)"
cd "$AX_CODE_SOURCE_CWD" || exit 1
# Apple Terminal.app / iTerm job names use the executable basename. exec a
# hardlink of node named AX-Code so the tab is not stuck on "node".
AX_CODE_NODE_BIN=\$(command -v node) || {
  echo "ax-code source launcher could not find node on PATH" >&2
  exit 127
}
AX_CODE_NODE_REAL="\$AX_CODE_NODE_BIN"
while [ -L "\$AX_CODE_NODE_REAL" ]; do
  AX_CODE_NODE_LINK=\$(readlink "\$AX_CODE_NODE_REAL")
  case "\$AX_CODE_NODE_LINK" in
    /*) AX_CODE_NODE_REAL="\$AX_CODE_NODE_LINK" ;;
    *) AX_CODE_NODE_REAL="\$(dirname "\$AX_CODE_NODE_REAL")/\$AX_CODE_NODE_LINK" ;;
  esac
done
AX_CODE_NODE_DIR=\$(CDPATH= cd -- "\$(dirname -- "\$AX_CODE_NODE_REAL")" && pwd -P)
AX_CODE_NODE_REAL="\$AX_CODE_NODE_DIR/\$(basename "\$AX_CODE_NODE_REAL")"
AX_CODE_CACHE="\${XDG_CACHE_HOME:-\$HOME/.cache}/ax-code/libexec/runtime"
mkdir -p "\$AX_CODE_CACHE/bin" "\$AX_CODE_CACHE/lib"
AX_CODE_BRANDED_NODE="\$AX_CODE_CACHE/bin/AX-Code"
ln -f "\$AX_CODE_NODE_REAL" "\$AX_CODE_BRANDED_NODE" 2>/dev/null || cp "\$AX_CODE_NODE_REAL" "\$AX_CODE_BRANDED_NODE" 2>/dev/null || true
if [ -d "\$AX_CODE_NODE_DIR/../lib" ]; then
  for lib in "\$AX_CODE_NODE_DIR"/../lib/libnode*; do
    [ -e "\$lib" ] || continue
    ln -sf "\$lib" "\$AX_CODE_CACHE/lib/\$(basename "\$lib")" 2>/dev/null || true
  done
fi
if [ -x "\$AX_CODE_BRANDED_NODE" ]; then
  exec "\$AX_CODE_BRANDED_NODE" "\$AX_CODE_SOURCE_NODE_FFI_RUNNER" --import tsx --import "\$AX_CODE_SOURCE_LOADER" --conditions=node "\$AX_CODE_SOURCE_ENTRY" "\$@"
fi
exec node "\$AX_CODE_SOURCE_NODE_FFI_RUNNER" --import tsx --import "\$AX_CODE_SOURCE_LOADER" --conditions=node "\$AX_CODE_SOURCE_ENTRY" "\$@"
`
}
