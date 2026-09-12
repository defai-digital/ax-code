// Pure view models for the Council and Arena tool renderers.
//
// Both tools emit rich metadata that the transcript previously discarded
// (council/arena were not registered, so they fell through to GenericTool,
// whose output is hidden by default). These functions turn that metadata into
// a small, tone-tagged display shape. They are intentionally:
//
// - pure (no Solid, no ax-tui imports) so they can be unit tested directly;
// - defensive (metadata arrives as `unknown`; missing/unknown fields degrade
//   to a muted "Unknown" view instead of throwing);
// - ASCII-only in their output, because these strings land in positioned TUI
//   rows where CJK-ambiguous glyph widths misalign the layout.

import { truncateToCellWidth } from "../last-input-view-model"

/** Closed tone union so the renderer never has to invent a color fallback. */
export type EnsembleTone = "ok" | "warn" | "error" | "muted"

export type EnsembleChip = {
  label: string
  count: number
  tone: EnsembleTone
}

export type CouncilView = {
  kind: "council"
  tone: EnsembleTone
  statusLabel: string
  membersLabel: string | null
  chips: EnsembleChip[]
  roster: string[]
  notes: string[]
  debateLabel: string | null
}

export type ArenaView = {
  kind: "arena"
  tone: EnsembleTone
  statusLabel: string
  modeLabel: string | null
  strategyLabel: string | null
  ranked: string[]
  /** Number of ranked entries hidden past the display cap (0 when all shown). */
  rankedOverflow: number
  rankedLabel: string | null
  notes: string[]
}

const MAX_ROSTER = 5
const MAX_RANKED = 5
const ID_BUDGET = 32

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

// Negative and non-finite counts are treated as absent; a fractional count is
// floored. The tools only emit non-negative integers, but metadata is
// untrusted input at this boundary.
function countField(record: Record<string, unknown>, key: string): number {
  const value = record[key]
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function stringList(record: Record<string, unknown>, key: string): string[] {
  const value = record[key]
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item !== "")
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const out: string[] = []
  for (const value of values) {
    if (!value) continue
    if (!out.includes(value)) out.push(value)
  }
  return out
}

// Member ids look like "provider/model". The provider prefix is repetitive
// across a roster and burns width, so show the model segment only, truncated
// to a cell-width budget.
function memberLabel(id: string): string {
  const slash = id.lastIndexOf("/")
  const short = slash >= 0 ? id.slice(slash + 1) : id
  return truncateToCellWidth(short, ID_BUDGET)
}

function capList(items: string[], max: number): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max), `+${items.length - max} more`]
}

function degradedCouncil(): CouncilView {
  return {
    kind: "council",
    tone: "muted",
    statusLabel: "Unknown",
    membersLabel: null,
    chips: [],
    roster: [],
    notes: [],
    debateLabel: null,
  }
}

function degradedArena(): ArenaView {
  return {
    kind: "arena",
    tone: "muted",
    statusLabel: "Unknown",
    modeLabel: null,
    strategyLabel: null,
    ranked: [],
    rankedOverflow: 0,
    rankedLabel: null,
    notes: [],
  }
}

const COUNCIL_STATUS: Record<string, { label: string; tone: EnsembleTone }> = {
  ok: { label: "Complete", tone: "ok" },
  incomplete: { label: "Incomplete", tone: "warn" },
  disabled: { label: "Disabled", tone: "muted" },
  context_rejected: { label: "Context too large", tone: "error" },
  budget_rejected: { label: "Budget exceeded", tone: "error" },
  no_members: { label: "No members available", tone: "error" },
  insufficient_members: { label: "Need ≥2 members", tone: "error" },
}

const COUNCIL_CHIPS: Array<{ key: string; label: string; tone: EnsembleTone }> = [
  { key: "consensusCount", label: "consensus", tone: "ok" },
  { key: "majorityCount", label: "majority", tone: "ok" },
  { key: "minorityCount", label: "minority", tone: "warn" },
  { key: "singletonCount", label: "singleton", tone: "muted" },
]

export function councilView(metadata: unknown, _input?: unknown): CouncilView {
  if (!isRecord(metadata)) return degradedCouncil()

  const status = stringField(metadata, "status")
  const mapped = (status ? COUNCIL_STATUS[status] : undefined) ?? { label: "Unknown", tone: "muted" as const }

  const total = countField(metadata, "totalMembers")
  const successful = countField(metadata, "successfulMembers")
  const membersLabel = total > 0 ? `${successful}/${total} members` : null

  let chips = COUNCIL_CHIPS.map((chip) => ({
    label: chip.label,
    count: countField(metadata, chip.key),
    tone: chip.tone,
  })).filter((chip) => chip.count > 0)
  // Strongest agreement first; ties keep the consensus -> singleton order.
  chips = chips.toSorted((a, b) => b.count - a.count)
  // A lone singleton is not "agreement" — relabel it so the row does not
  // imply the tier system fired when there was really one unshared finding.
  if (chips.length === 1 && chips[0]!.label === "singleton") {
    chips = [{ label: "single answer", count: chips[0]!.count, tone: "muted" }]
  }

  const roster = capList([...new Set(stringList(metadata, "memberIds"))].map(memberLabel), MAX_ROSTER)

  // Root causes first: why members were skipped, then why the run was capped.
  const notes = uniqueNonEmpty([...stringList(metadata, "selectionErrors"), ...stringList(metadata, "budgetReasons")])
  const stopReason = stringField(metadata, "debateStopReason")
  if (stopReason && /error|reject|fail|abort/i.test(stopReason)) notes.push(stopReason)

  const rounds = countField(metadata, "debateRoundsRun")
  const debateLabel = rounds > 0 ? `${rounds} debate round${rounds === 1 ? "" : "s"}` : null

  return {
    kind: "council",
    tone: mapped.tone,
    statusLabel: mapped.label,
    membersLabel,
    chips,
    roster,
    notes,
    debateLabel,
  }
}

const ARENA_STATUS: Record<string, { label: string; tone: EnsembleTone }> = {
  ok: { label: "Complete", tone: "ok" },
  incomplete: { label: "Incomplete", tone: "warn" },
  no_successful_candidate: { label: "No valid proposals", tone: "error" },
  no_verified_candidate: { label: "No verified candidate", tone: "warn" },
  disabled: { label: "Disabled", tone: "muted" },
  not_git: { label: "Requires a git repo", tone: "error" },
  no_base_commit: { label: "Requires a base commit", tone: "error" },
  dirty_worktree: { label: "Worktree not clean", tone: "error" },
}

const ARENA_STRATEGY: Record<string, string> = {
  verify_first: "Verify first",
  diversity: "Diversity",
  hybrid_score: "Hybrid score",
}

export function arenaView(metadata: unknown, _input?: unknown): ArenaView {
  if (!isRecord(metadata)) return degradedArena()

  const status = stringField(metadata, "status")
  const mode = stringField(metadata, "mode")
  let mapped = (status ? ARENA_STATUS[status] : undefined) ?? { label: "Unknown", tone: "muted" as const }
  // Both modes report status "ok"; the meaningful distinction is whether the
  // candidates were execution-verified (implement) or only ranked (plan).
  if (status === "ok") mapped = { label: mode === "implement" ? "Verified" : "Ranked", tone: "ok" }

  const modeLabel = mode === "implement" ? "Implement" : mode === "plan" ? "Plan" : null
  const strategy = stringField(metadata, "strategy")
  const strategyLabel = strategy ? (ARENA_STRATEGY[strategy] ?? strategy) : null

  // Count the real contestants before the display cap: capList's trailing
  // "+N more" sentinel must never inflate the count or be numbered as a rank.
  // Identity must be compared before provider removal and display truncation.
  const rankedIds = [...new Set(stringList(metadata, "rankedIds"))]
  const uniqueRanked = rankedIds.map(memberLabel)
  const ranked = uniqueRanked.slice(0, MAX_RANKED)
  const rankedOverflow = uniqueRanked.length - ranked.length
  const rankedLabel = rankedIds.length > 0 ? `${rankedIds.length} contestant${rankedIds.length === 1 ? "" : "s"}` : null

  const errorCount = countField(metadata, "errorCount")
  const worktrees = stringList(metadata, "worktrees")
  const notes = uniqueNonEmpty([
    ...stringList(metadata, "selectionErrors"),
    errorCount > 0 ? `${errorCount} member error${errorCount === 1 ? "" : "s"}` : undefined,
    ...stringList(metadata, "budgetReasons"),
    worktrees.length > 0 ? `${worktrees.length} worktree${worktrees.length === 1 ? "" : "s"}` : undefined,
  ])

  return {
    kind: "arena",
    tone: mapped.tone,
    statusLabel: mapped.label,
    modeLabel,
    strategyLabel,
    ranked,
    rankedOverflow,
    rankedLabel,
    notes,
  }
}
