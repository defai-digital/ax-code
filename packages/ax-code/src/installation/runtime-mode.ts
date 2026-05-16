/**
 * Detects whether ax-code is running as a compiled Bun binary, from source
 * via `bun run`, or as a packaged source-plus-bun distribution.
 *
 * This is distinct from `Installation.method()` which detects the package
 * manager used to install (npm, brew, curl, etc.). Runtime mode is about
 * which executable is actually loading the code — and is the signal
 * support uses to triage compiled-binary-specific bugs.
 */
// AX_CODE_VERSION and AX_CODE_CHANNEL are global build-time constants
// declared in `./index.ts`. They are referenced here without a local
// `declare global` block to avoid duplicate-declaration errors.

export type RuntimeMode = "compiled" | "source" | "bun-bundled" | "unknown"

export type DetectInput = {
  execPath?: string
  channel?: string
  versionDefined?: boolean
}

/**
 * Compiled binaries set `process.execPath` to the ax-code binary itself.
 * `bun run` (source or bun-bundled) sets it to the bun executable.
 * Local dev (CHANNEL === "local") sets the version global to "local".
 */
function basenameAcrossSeparators(input: string): string {
  // path.basename() uses platform-specific separators, so a Windows path
  // parsed on POSIX (or vice versa) loses the basename. Split on both.
  const last = Math.max(input.lastIndexOf("/"), input.lastIndexOf("\\"))
  return last >= 0 ? input.slice(last + 1) : input
}

export function detectRuntimeMode(input: DetectInput = {}): RuntimeMode {
  const execPath = input.execPath ?? process.execPath
  const base = basenameAcrossSeparators(execPath).toLowerCase()
  const isBunRuntime = base === "bun" || base === "bun.exe"
  const channel = input.channel ?? (typeof AX_CODE_CHANNEL === "string" ? AX_CODE_CHANNEL : undefined)
  const versionDefined = input.versionDefined ?? typeof AX_CODE_VERSION === "string"

  if (!isBunRuntime) {
    return versionDefined ? "compiled" : "unknown"
  }
  if (channel === "local" || !versionDefined) return "source"
  return "bun-bundled"
}

let cached: RuntimeMode | undefined
export function runtimeMode(): RuntimeMode {
  if (cached) return cached
  cached = detectRuntimeMode()
  return cached
}
