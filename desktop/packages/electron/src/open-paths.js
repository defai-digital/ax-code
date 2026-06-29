"use strict"

const path = require("path")
const { fileURLToPath } = require("url")

const pathForPlatform = (platform) => (platform === "win32" ? path.win32 : path.posix)
const pathKeyForPlatform = (value, platform) => (platform === "win32" ? value.toLowerCase() : value)

const normalizeCandidate = (value, options = {}) => {
  if (typeof value !== "string") return null
  let candidate = value.trim()
  if (!candidate || candidate.startsWith("-")) return null

  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim()
  }
  if (!candidate) return null

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) {
    if (!candidate.toLowerCase().startsWith("file://")) return null
    try {
      candidate = fileURLToPath(candidate)
    } catch {
      return null
    }
  }

  const platform = options.platform || process.platform
  const pathTools = pathForPlatform(platform)
  const appExecutablePath = typeof options.appExecutablePath === "string" ? options.appExecutablePath.trim() : ""

  if (appExecutablePath) {
    const normalizedCandidate = pathTools.normalize(candidate)
    const normalizedExecutable = pathTools.normalize(appExecutablePath)
    if (pathKeyForPlatform(normalizedCandidate, platform) === pathKeyForPlatform(normalizedExecutable, platform)) {
      return null
    }
  }

  const cwd = typeof options.cwd === "string" && options.cwd.trim() ? options.cwd.trim() : process.cwd()

  return pathTools.isAbsolute(candidate) ? pathTools.normalize(candidate) : pathTools.resolve(cwd, candidate)
}

const collectOpenPathCandidates = (argv, options = {}) => {
  if (!Array.isArray(argv)) return []
  const seen = new Set()
  const result = []

  for (const arg of argv) {
    const candidate = normalizeCandidate(arg, options)
    if (!candidate) continue

    const key = pathKeyForPlatform(candidate, options.platform || process.platform)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(candidate)
  }

  return result
}

module.exports = {
  collectOpenPathCandidates,
  normalizeCandidate,
}
