import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

/**
 * Discover project roots registered by sibling coding agents (Codex, Kimi Code).
 * Used so AX Code Desktop can import workspaces without re-picking folders.
 */

const pathExists = async (candidate) => {
  try {
    const stat = await fs.stat(candidate)
    return stat.isDirectory()
  } catch {
    return false
  }
}

const normalizePath = (value) => {
  if (typeof value !== "string") return ""
  const trimmed = value.trim()
  if (!trimmed) return ""
  // Keep absolute paths only — agent registries always store absolute roots.
  if (!path.isAbsolute(trimmed)) return ""
  return path.resolve(trimmed)
}

const deriveName = (root) => {
  const base = path.basename(root)
  return base || root
}

/**
 * Parse Codex config.toml for:
 *   [projects."/path/to/repo"]
 *   trust_level = "trusted"
 *
 * We only need the path keys; trust is informational for the import UI.
 */
export const parseCodexProjectsToml = (text) => {
  if (typeof text !== "string" || !text) {
    return []
  }

  const results = []
  const seen = new Set()
  // Match [projects."/abs/path"] or [projects.'/abs/path']
  const sectionRe = /^\[projects\.(?:"([^"]+)"|'([^']+)')\]\s*$/gm
  let match
  while ((match = sectionRe.exec(text)) !== null) {
    const raw = match[1] || match[2] || ""
    const root = normalizePath(raw)
    if (!root || seen.has(root)) continue
    seen.add(root)

    // Peek nearby lines for trust_level (optional).
    const slice = text.slice(match.index, match.index + 240)
    const trustMatch = /trust_level\s*=\s*"([^"]+)"/.exec(slice)
    const trustLevel = trustMatch?.[1] === "trusted" || trustMatch?.[1] === "untrusted" ? trustMatch[1] : null

    results.push({
      root,
      name: deriveName(root),
      source: "codex",
      trustLevel,
      lastOpenedAt: null,
    })
  }
  return results
}

/**
 * Parse Kimi Code workspaces.json:
 * { "workspaces": { "wd_…": { root, name, last_opened_at, created_at } } }
 */
export const parseKimiWorkspacesJson = (text) => {
  if (typeof text !== "string" || !text) {
    return []
  }

  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }

  const workspaces = parsed?.workspaces
  if (!workspaces || typeof workspaces !== "object") {
    return []
  }

  const results = []
  const seen = new Set()
  for (const entry of Object.values(workspaces)) {
    if (!entry || typeof entry !== "object") continue
    const root = normalizePath(typeof entry.root === "string" ? entry.root : "")
    if (!root || seen.has(root)) continue
    seen.add(root)

    const name =
      typeof entry.name === "string" && entry.name.trim()
        ? entry.name.trim()
        : deriveName(root)

    let lastOpenedAt = null
    if (typeof entry.last_opened_at === "string") {
      const ms = Date.parse(entry.last_opened_at)
      if (Number.isFinite(ms)) lastOpenedAt = ms
    } else if (typeof entry.last_opened_at === "number" && Number.isFinite(entry.last_opened_at)) {
      lastOpenedAt = entry.last_opened_at
    }

    results.push({
      root,
      name,
      source: "kimi",
      trustLevel: null,
      lastOpenedAt,
    })
  }
  return results
}

/**
 * @param {{ homeDir?: string, existingPaths?: string[], readFile?: typeof fs.readFile, exists?: typeof pathExists }} options
 */
export const discoverExternalProjects = async (options = {}) => {
  const homeDir = options.homeDir || os.homedir()
  const readFile = options.readFile || ((filePath) => fs.readFile(filePath, "utf8"))
  const exists = options.exists || pathExists

  const existing = new Set(
    (options.existingPaths || [])
      .map((value) => normalizePath(value))
      .filter(Boolean),
  )

  const codexConfigPath = path.join(homeDir, ".codex", "config.toml")
  const kimiWorkspacesPath = path.join(homeDir, ".kimi-code", "workspaces.json")

  const candidates = []
  const sources = {
    codex: { path: codexConfigPath, found: false, count: 0 },
    kimi: { path: kimiWorkspacesPath, found: false, count: 0 },
  }

  try {
    const codexText = await readFile(codexConfigPath)
    const parsed = parseCodexProjectsToml(codexText)
    sources.codex.found = true
    sources.codex.count = parsed.length
    candidates.push(...parsed)
  } catch {
    // missing or unreadable — skip
  }

  try {
    const kimiText = await readFile(kimiWorkspacesPath)
    const parsed = parseKimiWorkspacesJson(kimiText)
    sources.kimi.found = true
    sources.kimi.count = parsed.length
    candidates.push(...parsed)
  } catch {
    // missing or unreadable — skip
  }

  // Deduplicate by root across sources; prefer kimi last_opened_at when both list same path.
  const byRoot = new Map()
  for (const candidate of candidates) {
    const prior = byRoot.get(candidate.root)
    if (!prior) {
      byRoot.set(candidate.root, {
        ...candidate,
        sources: [candidate.source],
      })
      continue
    }
    const sourcesList = Array.from(new Set([...(prior.sources || [prior.source]), candidate.source]))
    const lastOpenedAt =
      typeof candidate.lastOpenedAt === "number"
        ? Math.max(prior.lastOpenedAt ?? 0, candidate.lastOpenedAt)
        : prior.lastOpenedAt
    byRoot.set(candidate.root, {
      ...prior,
      name: prior.name || candidate.name,
      sources: sourcesList,
      source: sourcesList.length > 1 ? "both" : sourcesList[0],
      lastOpenedAt: lastOpenedAt || null,
      trustLevel: prior.trustLevel || candidate.trustLevel,
    })
  }

  const enriched = []
  for (const candidate of byRoot.values()) {
    const existsOnDisk = await exists(candidate.root)
    enriched.push({
      root: candidate.root,
      name: candidate.name,
      source: candidate.source,
      sources: candidate.sources || [candidate.source],
      trustLevel: candidate.trustLevel,
      lastOpenedAt: candidate.lastOpenedAt,
      exists: existsOnDisk,
      alreadyImported: existing.has(candidate.root),
    })
  }

  enriched.sort((a, b) => {
    // Prefer importable, not-yet-imported, then recency, then name.
    if (a.alreadyImported !== b.alreadyImported) return a.alreadyImported ? 1 : -1
    if (a.exists !== b.exists) return a.exists ? -1 : 1
    const aOpened = a.lastOpenedAt ?? 0
    const bOpened = b.lastOpenedAt ?? 0
    if (aOpened !== bOpened) return bOpened - aOpened
    return a.name.localeCompare(b.name)
  })

  return {
    candidates: enriched,
    sources,
  }
}

export const registerDiscoverExternalProjectRoutes = (app, dependencies = {}) => {
  const {
    os: osDep = os,
    fsPromises = fs,
    path: pathDep = path,
    readSettingsFromDiskMigrated,
    sanitizeProjects,
  } = dependencies

  app.get("/api/projects/discover-external", async (_req, res) => {
    try {
      let existingPaths = []
      if (typeof readSettingsFromDiskMigrated === "function") {
        const settings = await readSettingsFromDiskMigrated()
        const projects =
          typeof sanitizeProjects === "function"
            ? sanitizeProjects(settings?.projects || []) || []
            : Array.isArray(settings?.projects)
              ? settings.projects
              : []
        existingPaths = projects.map((project) => project.path).filter(Boolean)
      }

      const result = await discoverExternalProjects({
        homeDir: osDep.homedir(),
        existingPaths,
        readFile: (filePath) => fsPromises.readFile(filePath, "utf8"),
        exists: async (candidate) => {
          try {
            const stat = await fsPromises.stat(candidate)
            return stat.isDirectory()
          } catch {
            return false
          }
        },
      })

      return res.json(result)
    } catch (error) {
      console.error("Failed to discover external projects:", error)
      return res.status(500).json({ error: error?.message || "Failed to discover external projects" })
    }
  })
}
