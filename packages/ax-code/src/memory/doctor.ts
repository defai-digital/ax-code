import type { MemoryEntry, MemoryEntryKind, MemorySection, ProjectMemory } from "./types"
import * as store from "./store"

export type MemoryDoctorStatus = "ok" | "warn" | "error"
export type MemoryDoctorSource = "project" | "global"

export interface MemoryDoctorIssue {
  status: Exclude<MemoryDoctorStatus, "ok">
  code:
    | "load_failed"
    | "duplicate_entry"
    | "duplicate_content"
    | "expired_entry"
    | "invalid_expires_at"
    | "invalid_confidence"
    | "low_confidence"
    | "blank_scope_value"
    | "stale_scan"
  source: MemoryDoctorSource
  message: string
  kind?: MemoryEntryKind
  entryName?: string
}

export interface MemoryDoctorReport {
  status: MemoryDoctorStatus
  issues: MemoryDoctorIssue[]
  checked: {
    project: boolean
    global: boolean
  }
}

export interface MemoryDoctorOptions {
  scope?: "project" | "global" | "all"
  now?: Date
}

const ENTRY_KINDS: MemoryEntryKind[] = ["feedback", "userPrefs", "decisions", "reference"]
const LOW_CONFIDENCE_THRESHOLD = 0.5
const STALE_SCAN_MS = 30 * 24 * 60 * 60 * 1000

export async function doctor(projectRoot: string, opts: MemoryDoctorOptions = {}): Promise<MemoryDoctorReport> {
  const scope = opts.scope ?? "all"
  const now = opts.now ?? new Date()
  const issues: MemoryDoctorIssue[] = []
  const checked = { project: false, global: false }

  if (scope === "project" || scope === "all") {
    checked.project = true
    const memory = await store.load(projectRoot).catch((error) => {
      issues.push({
        status: "error",
        code: "load_failed",
        source: "project",
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    })
    if (memory) issues.push(...inspectMemory(memory, "project", now))
  }

  if (scope === "global" || scope === "all") {
    checked.global = true
    const memory = await store.loadGlobal().catch((error) => {
      issues.push({
        status: "error",
        code: "load_failed",
        source: "global",
        message: error instanceof Error ? error.message : String(error),
      })
      return null
    })
    if (memory) issues.push(...inspectMemory(memory, "global", now))
  }

  return {
    status: issues.some((issue) => issue.status === "error") ? "error" : issues.length > 0 ? "warn" : "ok",
    issues,
    checked,
  }
}

function inspectMemory(memory: ProjectMemory, source: MemoryDoctorSource, now: Date): MemoryDoctorIssue[] {
  const issues: MemoryDoctorIssue[] = []
  for (const kind of ENTRY_KINDS) {
    const entries = memory.sections[kind]?.entries ?? []
    issues.push(...inspectDuplicates(entries, source, kind))
    issues.push(...inspectDuplicateContent(entries, source, kind))
    for (const entry of entries) issues.push(...inspectEntry(entry, source, kind, now))
  }
  if (source === "project") issues.push(...inspectScannedSections(memory.sections, now))
  return issues
}

function inspectDuplicates(
  entries: MemoryEntry[],
  source: MemoryDoctorSource,
  kind: MemoryEntryKind,
): MemoryDoctorIssue[] {
  const seen = new Set<string>()
  const issues: MemoryDoctorIssue[] = []
  for (const entry of entries) {
    const key = entry.name.trim().toLowerCase()
    if (!key) continue
    if (!seen.has(key)) {
      seen.add(key)
      continue
    }
    issues.push({
      status: "warn",
      code: "duplicate_entry",
      source,
      kind,
      entryName: entry.name,
      message: `duplicate ${kind} memory entry: ${entry.name}`,
    })
  }
  return issues
}

function inspectDuplicateContent(
  entries: MemoryEntry[],
  source: MemoryDoctorSource,
  kind: MemoryEntryKind,
): MemoryDoctorIssue[] {
  const seen = new Map<string, string>()
  const issues: MemoryDoctorIssue[] = []
  for (const entry of entries) {
    const key = normalizeContent(entry.body)
    if (!key) continue
    const first = seen.get(key)
    if (!first) {
      seen.set(key, entry.name)
      continue
    }
    if (first.trim().toLowerCase() === entry.name.trim().toLowerCase()) continue
    issues.push({
      status: "warn",
      code: "duplicate_content",
      source,
      kind,
      entryName: entry.name,
      message: `duplicate ${kind} memory content: ${entry.name} duplicates ${first}`,
    })
  }
  return issues
}

function inspectEntry(
  entry: MemoryEntry,
  source: MemoryDoctorSource,
  kind: MemoryEntryKind,
  now: Date,
): MemoryDoctorIssue[] {
  const issues: MemoryDoctorIssue[] = []
  const context = { source, kind, entryName: entry.name }

  if (entry.expiresAt) {
    const expiresAt = new Date(entry.expiresAt).getTime()
    if (!Number.isFinite(expiresAt)) {
      issues.push({
        ...context,
        status: "error",
        code: "invalid_expires_at",
        message: `invalid expiresAt for memory entry: ${entry.name}`,
      })
    } else if (expiresAt <= now.getTime()) {
      issues.push({
        ...context,
        status: "warn",
        code: "expired_entry",
        message: `expired memory entry: ${entry.name}`,
      })
    }
  }

  if (entry.confidence !== undefined) {
    if (!Number.isFinite(entry.confidence) || entry.confidence < 0 || entry.confidence > 1) {
      issues.push({
        ...context,
        status: "error",
        code: "invalid_confidence",
        message: `invalid confidence for memory entry: ${entry.name}`,
      })
    } else if (entry.confidence < LOW_CONFIDENCE_THRESHOLD) {
      issues.push({
        ...context,
        status: "warn",
        code: "low_confidence",
        message: `low-confidence memory entry: ${entry.name}`,
      })
    }
  }

  for (const value of [...(entry.tags ?? []), ...(entry.pathGlobs ?? []), ...(entry.agents ?? [])]) {
    if (value.trim()) continue
    issues.push({
      ...context,
      status: "warn",
      code: "blank_scope_value",
      message: `blank scope value on memory entry: ${entry.name}`,
    })
    break
  }

  return issues
}

function normalizeContent(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/\s+/g, " ") ?? ""
}

function inspectScannedSections(sections: ProjectMemory["sections"], now: Date): MemoryDoctorIssue[] {
  const scanned: Array<[string, MemorySection | undefined]> = [
    ["patterns", sections.patterns],
    ["config", sections.config],
    ["structure", sections.structure],
    ["readme", sections.readme],
  ]
  const issues: MemoryDoctorIssue[] = []
  for (const [name, section] of scanned) {
    if (!section?.scannedAt) continue
    const scannedAt = new Date(section.scannedAt).getTime()
    if (!Number.isFinite(scannedAt)) continue
    if (now.getTime() - scannedAt < STALE_SCAN_MS) continue
    issues.push({
      status: "warn",
      code: "stale_scan",
      source: "project",
      message: `stale scanned memory section: ${name}`,
    })
  }
  return issues
}
