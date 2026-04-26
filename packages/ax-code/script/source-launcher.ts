/**
 * Source-launcher script generation.
 *
 * Both the developer-facing `pnpm setup:cli` command and the future
 * brew/npm source-distribution path produce the same kind of shell shim:
 * a script that re-execs `bun run` against the ax-code source tree.
 *
 * Keeping the generation in one place ensures both surfaces stay in sync
 * — the ones we ship to end users via brew/npm must behave identically
 * to the contributor launcher that has been validated for ~6 months.
 */
import path from "path"

export type SourceLauncherInput = {
  /**
   * Repository or installation root containing `packages/ax-code`. For dev,
   * this is the checkout root. For brew, this is `<formula>/libexec`. For
   * npm, this is the npm package directory.
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
    return `@echo off\nset AX_CODE_ORIGINAL_CWD=%CD%\nbun run --cwd "${cwdPath}" --conditions=browser "${entry}" %*\n`
  }
  return `#!/bin/sh\nAX_CODE_ORIGINAL_CWD="\$(pwd)" exec bun run --cwd "${cwdPath}" --conditions=browser "${entry}" "$@"\n`
}
