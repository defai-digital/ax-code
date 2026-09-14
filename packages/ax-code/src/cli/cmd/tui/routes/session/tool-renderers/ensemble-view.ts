import { english, type Translate, type MessageKey } from "../../../i18n"
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
// - localized only at presentation time; raw evidence and identities are preserved.

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

function capList(items: string[], max: number, t: Translate): string[] {
  if (items.length <= max) return items
  return [...items.slice(0, max), t("ensemble.more", { count: items.length - max })]
}

function degradedCouncil(t: Translate): CouncilView {
  return {
    kind: "council",
    tone: "muted",
    statusLabel: t("common.unknown"),
    membersLabel: null,
    chips: [],
    roster: [],
    notes: [],
    debateLabel: null,
  }
}

function degradedArena(t: Translate): ArenaView {
  return {
    kind: "arena",
    tone: "muted",
    statusLabel: t("common.unknown"),
    modeLabel: null,
    strategyLabel: null,
    ranked: [],
    rankedOverflow: 0,
    rankedLabel: null,
    notes: [],
  }
}

const COUNCIL_STATUS: Record<string, { label: MessageKey; tone: EnsembleTone }> = {
  ok: { label: "ensemble.complete", tone: "ok" },
  incomplete: { label: "ensemble.incomplete", tone: "warn" },
  disabled: { label: "ensemble.disabled", tone: "muted" },
  context_rejected: { label: "ensemble.context", tone: "error" },
  budget_rejected: { label: "ensemble.budgetExceeded", tone: "error" },
  no_members: { label: "ensemble.noMembers", tone: "error" },
  insufficient_members: { label: "ensemble.twoMembers", tone: "error" },
}

const COUNCIL_CHIPS: Array<{ key: string; label: MessageKey; tone: EnsembleTone }> = [
  { key: "consensusCount", label: "ensemble.consensus", tone: "ok" },
  { key: "majorityCount", label: "ensemble.majority", tone: "ok" },
  { key: "minorityCount", label: "ensemble.minority", tone: "warn" },
  { key: "singletonCount", label: "ensemble.singleton", tone: "muted" },
]

export function councilView(metadata: unknown, _input?: unknown, t: Translate = english): CouncilView {
  if (!isRecord(metadata)) return degradedCouncil(t)

  const status = stringField(metadata, "status")
  const mapped = (status ? COUNCIL_STATUS[status] : undefined) ?? { label: "common.unknown", tone: "muted" as const }

  const total = countField(metadata, "totalMembers")
  const successful = countField(metadata, "successfulMembers")
  const membersLabel = total > 0 ? t("ensemble.memberCount", { successful, total }) : null

  let chips = COUNCIL_CHIPS.map((chip) => ({
    label: chip.label,
    count: countField(metadata, chip.key),
    tone: chip.tone,
  })).filter((chip) => chip.count > 0)
  // Strongest agreement first; ties keep the consensus -> singleton order.
  chips = chips.toSorted((a, b) => b.count - a.count)
  // A lone singleton is not "agreement" — relabel it so the row does not
  // imply the tier system fired when there was really one unshared finding.
  if (chips.length === 1 && chips[0]!.label === "ensemble.singleton") {
    chips = [{ label: "ensemble.singleAnswer", count: chips[0]!.count, tone: "muted" }]
  }

  const roster = capList([...new Set(stringList(metadata, "memberIds"))].map(memberLabel), MAX_ROSTER, t)

  // Root causes first: why members were skipped, then why the run was capped.
  const notes = uniqueNonEmpty([...stringList(metadata, "selectionErrors"), ...stringList(metadata, "budgetReasons")])
  const stopReason = stringField(metadata, "debateStopReason")
  if (stopReason && /error|reject|fail|abort/i.test(stopReason)) notes.push(stopReason)

  const rounds = countField(metadata, "debateRoundsRun")
  const debateLabel =
    rounds > 0 ? t(rounds === 1 ? "ensemble.roundOne" : "ensemble.roundMany", { count: rounds }) : null

  return {
    kind: "council",
    tone: mapped.tone,
    statusLabel: t(mapped.label),
    membersLabel,
    chips: chips.map((chip) => ({ ...chip, label: t(chip.label) })),
    roster,
    notes,
    debateLabel,
  }
}

const ARENA_STATUS: Record<string, { label: MessageKey; tone: EnsembleTone }> = {
  ok: { label: "ensemble.complete", tone: "ok" },
  incomplete: { label: "ensemble.incomplete", tone: "warn" },
  no_successful_candidate: { label: "ensemble.noProposals", tone: "error" },
  no_verified_candidate: { label: "ensemble.noVerified", tone: "warn" },
  disabled: { label: "ensemble.disabled", tone: "muted" },
  context_rejected: { label: "ensemble.context", tone: "error" },
  budget_rejected: { label: "ensemble.budgetRejected", tone: "error" },
  insufficient_members: { label: "ensemble.twoModels", tone: "warn" },
  not_git: { label: "ensemble.git", tone: "error" },
  no_base_commit: { label: "ensemble.baseCommit", tone: "error" },
  dirty_worktree: { label: "ensemble.dirty", tone: "error" },
}

const ARENA_STRATEGY: Record<string, MessageKey> = {
  verify_first: "ensemble.verifyFirst",
  diversity: "ensemble.diversity",
  hybrid_score: "ensemble.hybrid",
}

export function arenaView(metadata: unknown, _input?: unknown, t: Translate = english): ArenaView {
  if (!isRecord(metadata)) return degradedArena(t)

  const status = stringField(metadata, "status")
  const mode = stringField(metadata, "mode")
  let mapped = (status ? ARENA_STATUS[status] : undefined) ?? { label: "common.unknown", tone: "muted" as const }
  // Both modes report status "ok"; the meaningful distinction is whether the
  // candidates were execution-verified (implement) or only ranked (plan).
  if (status === "ok") mapped = { label: mode === "implement" ? "ensemble.verified" : "ensemble.ranked", tone: "ok" }

  const modeLabel = mode === "implement" ? t("ensemble.implement") : mode === "plan" ? t("common.plan") : null
  const strategy = stringField(metadata, "strategy")
  const strategyLabel = strategy ? (ARENA_STRATEGY[strategy] ? t(ARENA_STRATEGY[strategy]) : strategy) : null

  // Count the real contestants before the display cap: capList's trailing
  // "+N more" sentinel must never inflate the count or be numbered as a rank.
  // Identity must be compared before provider removal and display truncation.
  const rankedIds = [...new Set(stringList(metadata, "rankedIds"))]
  const uniqueRanked = rankedIds.map(memberLabel)
  const ranked = uniqueRanked.slice(0, MAX_RANKED)
  const rankedOverflow = uniqueRanked.length - ranked.length
  const rankedLabel =
    rankedIds.length > 0
      ? t(rankedIds.length === 1 ? "ensemble.contestantOne" : "ensemble.contestantMany", { count: rankedIds.length })
      : null

  const errorCount = countField(metadata, "errorCount")
  const worktrees = stringList(metadata, "worktrees")
  const notes = uniqueNonEmpty([
    ...stringList(metadata, "selectionErrors"),
    errorCount > 0
      ? t(errorCount === 1 ? "ensemble.errorOne" : "ensemble.errorMany", { count: errorCount })
      : undefined,
    ...stringList(metadata, "budgetReasons"),
    worktrees.length > 0
      ? t(worktrees.length === 1 ? "ensemble.worktreeOne" : "ensemble.worktreeMany", { count: worktrees.length })
      : undefined,
  ])

  return {
    kind: "arena",
    tone: mapped.tone,
    statusLabel: t(mapped.label),
    modeLabel,
    strategyLabel,
    ranked,
    rankedOverflow,
    rankedLabel,
    notes,
  }
}
