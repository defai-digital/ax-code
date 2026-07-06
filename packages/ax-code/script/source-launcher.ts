/**
 * Source-launcher script generation.
 *
 * The developer-facing `pnpm setup:cli -- --source` command produces a shell
 * shim that re-execs ax-code from the source tree on Node (tsx + the OpenTUI
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

export const WINDOWS_UTF8_WARNING = `for /f "tokens=2 delims=:" %%A in ('chcp') do set "AX_CODE_ACTIVE_CODEPAGE=%%A"
set "AX_CODE_ACTIVE_CODEPAGE=%AX_CODE_ACTIVE_CODEPAGE: =%"
if not "%AX_CODE_ACTIVE_CODEPAGE%"=="65001" (
  chcp 65001 >nul
  echo AX Code warning: switched terminal code page from %AX_CODE_ACTIVE_CODEPAGE% to UTF-8 ^(65001^) for TUI rendering. 1^>^&2
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
  echo Install the packaged runtime instead: curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install ^| bash 1>&2
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
  echo "Install the packaged runtime instead: curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install | bash" >&2
  exit 127
fi
if [ ! -f "$AX_CODE_SOURCE_NODE_FFI_RUNNER" ]; then
  echo "ax-code source launcher points at a missing node:ffi runner: $AX_CODE_SOURCE_NODE_FFI_RUNNER" >&2
  echo "Reinstall the source launcher from the current checkout." >&2
  exit 127
fi
export AX_CODE_ORIGINAL_CWD="\$(pwd)"
cd "$AX_CODE_SOURCE_CWD" || exit 1
exec node "$AX_CODE_SOURCE_NODE_FFI_RUNNER" --import tsx --import "$AX_CODE_SOURCE_LOADER" --conditions=node "$AX_CODE_SOURCE_ENTRY" "$@"
`
}
