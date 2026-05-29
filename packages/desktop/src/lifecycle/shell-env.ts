import { spawnSync, type SpawnSyncReturns } from "node:child_process"
import { userInfo } from "node:os"
import path from "node:path"

const SHELL_ENV_TIMEOUT_MS = 5_000

type ShellEnvProbeMode = "-il" | "-l"
type ShellEnvProbe = (shell: string, mode: ShellEnvProbeMode) => SpawnSyncReturns<Buffer>

let cachedShellEnv: Record<string, string> | null | undefined

export function loadDesktopSidecarEnvironment(
  options: {
    processEnv?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    shell?: string
    probe?: ShellEnvProbe
  } = {},
): Record<string, string> | undefined {
  const processEnv = options.processEnv ?? process.env
  const shellEnv = loadDesktopShellEnvironment(options)
  return mergeDesktopSidecarEnvironment({ shellEnv, processEnv, platform: options.platform })
}

export function loadDesktopShellEnvironment(
  options: {
    processEnv?: NodeJS.ProcessEnv
    platform?: NodeJS.Platform
    shell?: string
    probe?: ShellEnvProbe
  } = {},
): Record<string, string> | null {
  const platform = options.platform ?? process.platform
  if (platform === "win32") return null
  const cacheable = !options.shell && !options.probe && !options.processEnv && !options.platform
  if (cacheable && cachedShellEnv !== undefined) return cachedShellEnv

  const shell = options.shell ?? resolveUserShell(options.processEnv ?? process.env)
  const result = isNushell(shell)
    ? null
    : (probeShellEnvironment(shell, "-il", options.probe) ?? probeShellEnvironment(shell, "-l", options.probe))
  if (cacheable) cachedShellEnv = result
  return result
}

export function mergeDesktopSidecarEnvironment(input: {
  shellEnv: Record<string, string> | null | undefined
  processEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
}): Record<string, string> | undefined {
  const shellEnv = input.shellEnv
  const processEnv = input.processEnv ?? process.env
  const platform = input.platform ?? process.platform
  const fallbackPath = shellEnv ? undefined : desktopCliFallbackPath(processEnv, platform)
  if (!shellEnv && !fallbackPath) return undefined

  const env: Record<string, string> = {}
  if (shellEnv) {
    for (const [key, value] of Object.entries(shellEnv)) {
      if (key === "PATH" || value === "") continue
      if (processEnv[key] === undefined) env[key] = value
    }
  }
  const mergedPath = mergePathValues({
    shellPath: shellEnv?.PATH,
    processPath: processEnv.PATH,
    fallbackPath,
    delimiter: platform === "win32" ? ";" : ":",
  })
  if (mergedPath && mergedPath !== processEnv.PATH) env.PATH = mergedPath
  return Object.keys(env).length > 0 ? env : undefined
}

export function parseShellEnvOutput(output: Buffer): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of output.toString("utf8").split("\0")) {
    if (!line) continue
    const separator = line.indexOf("=")
    if (separator <= 0) continue
    env[line.slice(0, separator)] = line.slice(separator + 1)
  }
  return env
}

export function resolveUserShell(processEnv: NodeJS.ProcessEnv = process.env): string {
  if (processEnv.SHELL) return processEnv.SHELL
  try {
    const shell = userInfo().shell
    if (shell && shell !== "unknown") return shell
  } catch {
    // Fall back below when userInfo is unavailable in a packaged runtime.
  }
  return "/bin/sh"
}

export function isNushell(shell: string): boolean {
  const name = path.basename(shell).toLowerCase()
  return name === "nu" || name === "nu.exe"
}

export function resetDesktopShellEnvironmentCacheForTest() {
  cachedShellEnv = undefined
}

function probeShellEnvironment(
  shell: string,
  mode: ShellEnvProbeMode,
  probe: ShellEnvProbe = defaultShellEnvProbe,
): Record<string, string> | null {
  const result = probe(shell, mode)
  if (result.error || result.status !== 0) return null
  const env = parseShellEnvOutput(result.stdout)
  return Object.keys(env).length > 0 ? env : null
}

function defaultShellEnvProbe(shell: string, mode: ShellEnvProbeMode): SpawnSyncReturns<Buffer> {
  return spawnSync(shell, [mode, "-c", "env -0"], {
    stdio: ["ignore", "pipe", "ignore"],
    timeout: SHELL_ENV_TIMEOUT_MS,
    windowsHide: true,
  })
}

function desktopCliFallbackPath(processEnv: NodeJS.ProcessEnv, platform: NodeJS.Platform) {
  if (platform !== "darwin") return undefined
  const home = processEnv.HOME?.trim().replace(/\/+$/, "")
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    home ? `${home}/.local/bin` : undefined,
    home ? `${home}/.bun/bin` : undefined,
    home ? `${home}/.cargo/bin` : undefined,
    home ? `${home}/bin` : undefined,
  ]
    .filter((value): value is string => Boolean(value))
    .join(":")
}

function mergePathValues(input: { shellPath?: string; processPath?: string; fallbackPath?: string; delimiter: string }) {
  const seen = new Set<string>()
  const parts: string[] = []
  for (const value of [input.shellPath, input.processPath, input.fallbackPath]) {
    for (const part of (value ?? "").split(input.delimiter)) {
      if (!part || seen.has(part)) continue
      seen.add(part)
      parts.push(part)
    }
  }
  return parts.join(input.delimiter)
}
