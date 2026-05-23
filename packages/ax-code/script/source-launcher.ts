/**
 * Source-launcher script generation.
 *
 * The developer-facing `pnpm setup:cli -- --source` command produces a shell
 * shim that re-execs `bun run` against the ax-code source tree.
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

export function sourceLauncherScript(input: SourceLauncherInput): string {
  // Use platform-explicit path joiners so the generated script is correct
  // regardless of which host OS produced it (release pipelines build
  // Windows artifacts on Linux runners, dev tooling generates POSIX
  // shims from any host).
  const joiner = input.windows ? path.win32 : path.posix
  const root = input.windows ? input.root.replace(/\//g, "\\") : input.root.replace(/\\/g, "/")
  const cwdPath = joiner.join(root, "packages", "ax-code")
  const entry = joiner.join(root, "packages", "ax-code", "src", "index.ts")
  if (input.windows) {
    return `@echo off
set "AX_CODE_SOURCE_CWD=${cwdPath}"
set "AX_CODE_SOURCE_ENTRY=${entry}"
if not exist "%AX_CODE_SOURCE_CWD%\\" (
  echo ax-code source launcher points at a missing checkout: %AX_CODE_SOURCE_CWD% 1>&2
  echo Install the packaged runtime instead: curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install ^| bash 1>&2
  exit /b 127
)
set AX_CODE_ORIGINAL_CWD=%CD%
bun run --cwd "%AX_CODE_SOURCE_CWD%" --conditions=browser "%AX_CODE_SOURCE_ENTRY%" %*
`
  }
  return `#!/bin/sh
AX_CODE_SOURCE_CWD="${cwdPath}"
AX_CODE_SOURCE_ENTRY="${entry}"
if [ ! -d "$AX_CODE_SOURCE_CWD" ]; then
  echo "ax-code source launcher points at a missing checkout: $AX_CODE_SOURCE_CWD" >&2
  echo "Install the packaged runtime instead: curl -fsSL https://raw.githubusercontent.com/defai-digital/ax-code/main/install | bash" >&2
  exit 127
fi
AX_CODE_ORIGINAL_CWD="\$(pwd)" exec bun run --cwd "$AX_CODE_SOURCE_CWD" --conditions=browser "$AX_CODE_SOURCE_ENTRY" "$@"
`
}
