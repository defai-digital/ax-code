/**
 * Pure view-model for the desktop Session Pulse dashboard.
 * Maps DRE / risk API payloads into a calm, decision-first surface.
 * Vanity metrics (gauge scores, tool-count charts) are intentionally omitted.
 */

export type SessionPulseReadiness = "ready" | "needs_validation" | "needs_review" | "blocked" | "unknown"

export type SessionPulseChange = {
  file: string
  risk: string
  kind: string
  additions: number
  deletions: number
  signal?: string
}

export type SessionPulseValidation = {
  state: "passed" | "failed" | "not_run" | "unknown"
  commands: string[]
  /** Plain-language summary for the section header. */
  summary: string
}

export type SessionPulseModel = {
  readiness: SessionPulseReadiness
  headline: string
  reason: string | null
  decision: string | null
  primaryActionHint: string | null
  changes: SessionPulseChange[]
  filesChanged: number
  additions: number
  deletions: number
  validation: SessionPulseValidation
  unknowns: string[]
  mitigations: string[]
  drivers: string[]
  durationMs: number | null
  tokensIn: number | null
  tokensOut: number | null
  hasAnalysis: boolean
}

const READINESS_HEADLINES: Record<SessionPulseReadiness, string> = {
  ready: "Ready to accept",
  needs_validation: "Needs validation",
  needs_review: "Needs manual review",
  blocked: "Blocked — do not accept",
  unknown: "No analysis yet",
}

const READINESS_HINTS: Record<SessionPulseReadiness, string | null> = {
  ready: "Review the file list, then accept or continue the session.",
  needs_validation: "Run tests or the suggested validation commands before accepting.",
  needs_review: "Inspect high-risk files and drivers before accepting.",
  blocked: "Resolve blockers and unknowns before accepting this work.",
  unknown: "Send a message in chat so the agent can produce session evidence.",
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
}

function normalizeReadiness(value: unknown): SessionPulseReadiness {
  if (value === "ready" || value === "needs_validation" || value === "needs_review" || value === "blocked") {
    return value
  }
  return "unknown"
}

function normalizeValidationState(value: unknown): SessionPulseValidation["state"] {
  if (value === "passed" || value === "failed" || value === "not_run") return value
  return "unknown"
}

function validationSummary(state: SessionPulseValidation["state"], commands: string[], filesChanged: number): string {
  if (state === "passed") {
    return commands.length > 0 ? `${commands.length} validation command(s) passed` : "Validation passed"
  }
  if (state === "failed") {
    return commands.length > 0 ? `${commands.length} validation command(s) failed` : "Validation failed"
  }
  if (filesChanged > 0) {
    return "Code changed but no tests were run"
  }
  return "No validation commands recorded"
}

/**
 * Build a Session Pulse model from optional `/session/:id/dre` and `/session/:id/risk` payloads.
 * Either source may be missing; prefer risk for readiness/validation and DRE for decision/plan/tokens.
 */
export function buildSessionPulseModel(input: { dre?: unknown; risk?: unknown }): SessionPulseModel {
  const dre = asRecord(input.dre)
  const risk = asRecord(input.risk)
  const dreDetail = asRecord(dre?.detail)
  const assessment = asRecord(risk?.assessment)
  const signals = asRecord(assessment?.signals) ?? asRecord(dreDetail) // soft fallback

  const readiness = normalizeReadiness(assessment?.readiness ?? dreDetail?.readiness)
  const semantic =
    asRecord(risk?.semantic) ?? asRecord(dreDetail?.semantic) ?? asRecord(assessment?.semantic) ?? null

  const rawChanges = Array.isArray(semantic?.changes) ? semantic.changes : []
  const changes: SessionPulseChange[] = []
  for (const item of rawChanges) {
    if (changes.length >= 12) break
    const row = asRecord(item)
    if (!row) continue
    const file = asString(row.file)
    if (!file) continue
    const signalsList = asStringArray(row.signals)
    changes.push({
      file,
      risk: asString(row.risk) ?? "unknown",
      kind: (asString(row.kind) ?? "change").replace(/_/g, " "),
      additions: asNumber(row.additions) ?? 0,
      deletions: asNumber(row.deletions) ?? 0,
      signal: signalsList[0],
    })
  }

  const filesChanged =
    asNumber(semantic?.files) ?? asNumber(signals?.filesChanged) ?? (changes.length > 0 ? changes.length : 0)
  const additions =
    asNumber(semantic?.additions) ?? changes.reduce((sum, c) => sum + c.additions, 0)
  const deletions =
    asNumber(semantic?.deletions) ?? changes.reduce((sum, c) => sum + c.deletions, 0)

  const commands = asStringArray(signals?.validationCommands)
  const validationState = normalizeValidationState(signals?.validationState)
  const validation: SessionPulseValidation = {
    state: validationState,
    commands: commands.slice(0, 8),
    summary: validationSummary(validationState, commands, filesChanged),
  }

  const unknowns = asStringArray(assessment?.unknowns ?? risk?.unknowns ?? dreDetail?.unknowns).slice(0, 3)
  const mitigations = asStringArray(assessment?.mitigations ?? dreDetail?.mitigations).slice(0, 3)
  const drivers = asStringArray(risk?.drivers ?? dreDetail?.drivers).slice(0, 4)

  const decision = asString(dreDetail?.decision) ?? asString(assessment?.summary) ?? asString(semantic?.headline)
  const reason =
    unknowns[0] ??
    drivers[0] ??
    asString(semantic?.headline) ??
    (readiness === "unknown" ? null : asString(assessment?.summary))

  const tokens = asRecord(dreDetail?.tokens)
  const hasAnalysis = Boolean(
    dreDetail || assessment || semantic || changes.length > 0 || commands.length > 0 || decision,
  )

  return {
    readiness: hasAnalysis ? readiness : "unknown",
    headline: hasAnalysis ? READINESS_HEADLINES[readiness] : READINESS_HEADLINES.unknown,
    reason,
    decision,
    primaryActionHint: hasAnalysis ? READINESS_HINTS[readiness] : READINESS_HINTS.unknown,
    changes,
    filesChanged,
    additions,
    deletions,
    validation,
    unknowns,
    mitigations,
    drivers,
    durationMs: asNumber(dreDetail?.duration),
    tokensIn: asNumber(tokens?.input),
    tokensOut: asNumber(tokens?.output),
    hasAnalysis,
  }
}

export function formatDurationMs(ms: number | null): string | null {
  if (ms == null || ms < 0) return null
  if (ms < 1000) return `${Math.round(ms)}ms`
  // Round to whole seconds first so remainder never becomes "1m 60s".
  const totalSeconds = Math.round(ms / 1000)
  if (totalSeconds < 60) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${seconds}s`
}

export function formatTokenCount(n: number | null): string | null {
  if (n == null) return null
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}
