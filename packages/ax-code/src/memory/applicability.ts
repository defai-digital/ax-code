import path from "path"
import { minimatch } from "minimatch"
import type { MemoryEntry } from "./types"

export interface MemoryApplicabilityOptions {
  projectRoot: string
  agent?: string
  tags?: string[]
  paths?: string[]
  includeExpired?: boolean
  nowMs?: number
}

export function normalizeTags(tags?: string | string[]): string[] {
  const values = Array.isArray(tags) ? tags : tags ? tags.split(",") : []
  return values.map((tag) => tag.trim().toLowerCase()).filter(Boolean)
}

export function isExpired(entry: MemoryEntry, nowMs = Date.now()): boolean {
  if (!entry.expiresAt) return false
  const expiresAt = new Date(entry.expiresAt).getTime()
  return Number.isFinite(expiresAt) && expiresAt <= nowMs
}

export function matchesAgent(entry: MemoryEntry, agent?: string): boolean {
  if (!agent) return true
  if (!entry.agents || entry.agents.length === 0) return true
  return entry.agents.includes(agent)
}

export function matchesTags(entry: MemoryEntry, wantedTags: string[]): boolean {
  if (wantedTags.length === 0) return true
  const entryTags = new Set(entry.tags?.map((tag) => tag.toLowerCase()) ?? [])
  return wantedTags.every((tag) => entryTags.has(tag))
}

export function normalizePathForMatch(projectRoot: string, targetPath: string): string[] {
  const normalized = targetPath.replace(/\\/g, "/")
  const relative = path.isAbsolute(targetPath) ? path.relative(projectRoot, targetPath).replace(/\\/g, "/") : normalized
  return Array.from(new Set([normalized, relative, path.basename(normalized)].filter(Boolean)))
}

export function matchesPath(projectRoot: string, entry: MemoryEntry, targetPaths: string[] | undefined): boolean {
  if (!entry.pathGlobs || entry.pathGlobs.length === 0) return true
  if (!targetPaths || targetPaths.length === 0) return true
  const candidates = targetPaths.flatMap((targetPath) => normalizePathForMatch(projectRoot, targetPath))
  return entry.pathGlobs.some((pattern) =>
    candidates.some((candidate) => {
      const normalizedPattern = pattern.replace(/\\/g, "/")
      return minimatch(candidate, normalizedPattern, { dot: true, matchBase: !normalizedPattern.includes("/") })
    }),
  )
}

export function entryApplies(entry: MemoryEntry, opts: MemoryApplicabilityOptions): boolean {
  if (!opts.includeExpired && isExpired(entry, opts.nowMs)) return false
  if (!matchesAgent(entry, opts.agent)) return false
  if (!matchesTags(entry, opts.tags ?? [])) return false
  return matchesPath(opts.projectRoot, entry, opts.paths)
}
