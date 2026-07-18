import { spawnSync } from "node:child_process"

type ResolveNodeGypPythonOptions = {
  candidates?: readonly string[]
  inspect?: (candidate: string) => string | undefined
}

function inspectPythonVersion(candidate: string) {
  const result = spawnSync(
    candidate,
    ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5_000,
    },
  )
  if (result.status !== 0) return undefined
  return String(result.stdout).trim()
}

function supportsLegacyNodeGyp(version: string) {
  const match = /^(\d+)\.(\d+)$/.exec(version)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major === 3 && minor >= 8 && minor <= 11
}

/**
 * node-pty-prebuilt-multiarch still bundles a node-gyp release that imports
 * distutils, which Python 3.12 removed. Prefer a compatible interpreter when
 * one is available instead of letting npm pick a newer system Python.
 */
export function resolveLegacyNodeGypPython(options: ResolveNodeGypPythonOptions = {}) {
  const candidates = options.candidates ?? ["python3.11", "python3.10", "python3.9", "python3.8", "python3"]
  const inspect = options.inspect ?? inspectPythonVersion
  const seen = new Set<string>()

  for (const candidate of candidates) {
    if (seen.has(candidate)) continue
    seen.add(candidate)
    const version = inspect(candidate)
    if (version && supportsLegacyNodeGyp(version)) return candidate
  }
  return undefined
}
