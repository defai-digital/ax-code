import { formatDuration } from "@/util/format"
import { Locale } from "@/util/locale"
import { compactionGaugeLimit, type CompactionBudget } from "@/session/compaction-budget"
import { parseStepTokenWindows, stepDecodeTotals } from "./step-windows"

export type FooterSessionStatus =
  | {
      type: "idle"
    }
  | {
      type: "retry"
      attempt: number
      message: string
      next: number
    }
  | {
      type: "busy"
      step?: number
      maxSteps?: number
      segmentModelTurns?: number
      segmentModelTurnLimit?: number
      totalModelTurns?: number
      totalModelTurnLimit?: number
      continuations?: number
      continuationLimit?: number | null
      startedAt?: number
      lastActivityAt?: number
      activeTool?: string
      toolCallID?: string
      waitState?: "llm" | "tool"
    }

export type FooterSessionStatusTone = "muted" | "working" | "success" | "warning"

export type FooterSessionStatusView = {
  label?: string
  stale: boolean
  tone: FooterSessionStatusTone
}

const SESSION_STATUS_STALE_AFTER_MS = 60_000
const SESSION_STATUS_TOOL_STALE_AFTER_MS = 90_000
const MS_PER_SECOND = 1_000

type FooterTokenChip = { input: string; output: string; rate?: string }
type FooterGoalStatus = "active" | "paused" | "complete" | "blocked" | "budget_limited"
type FooterGoalInfo = {
  objective: string
  status: FooterGoalStatus
  tokenBudget?: number
  tokensUsed?: number
  remainingTokens?: number
}
type FooterGoalChip = {
  label: string
  tone: FooterSessionStatusTone
  resumeHint?: string
}

// Render token counts as "1.2k" / "480" depending on size. Tight format
// because the chip lives in the right-rail next to MCP / LSP and we
// don't want it eating multiple columns at every assistant tick.
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n >= 999_500) return `${(n / 1_000_000).toFixed(1)}m`
  return `${Math.round(n / 1000)}k`
}

// Sub-second rates are noisy and meaningless ("inf t/s" right after the
// first token lands) — gate rate calc on a real elapsed window. Anything
// shorter than this returns no rate; the caller hides the suffix.
export const RATE_MIN_ELAPSED_SECONDS = 0.5

// Single rate format for every tok/s readout (live footer chip, per-message
// footer stats) so the numbers never diverge in style.
export function formatTokenRate(rate: number): string {
  return rate >= 100 ? `${Math.round(rate)} t/s` : `${rate.toFixed(1)} t/s`
}

// Build the per-turn token chip view from the most-recent assistant
// message plus the current turn's start timestamp. Rate is OUTPUT
// tokens per second — that's what the user sees "happening" during a
// stream. Returns `rate` undefined when the turn is settled (startedAt
// not supplied), when there's no meaningful elapsed window yet, or
// when there are no output tokens to report against.
//
// When the message's parts are supplied and carry step data, the rate is
// computed over the finished steps' decode windows instead of the
// wall-clock window: message token totals accumulate across steps while
// the wall clock keeps running through tool execution, so the naive
// output/elapsed rate continuously decays during every tool call and
// mid-step stream — a number that reads as "the model is slowing down"
// when nothing about decode speed changed.
export function footerTokenChip(input: {
  tokens?: { input?: number; output?: number }
  startedAt?: number
  now?: number
  parts?: readonly unknown[]
}): FooterTokenChip | undefined {
  const inTok = input.tokens?.input ?? 0
  const outTok = input.tokens?.output ?? 0
  if (inTok <= 0 && outTok <= 0) return undefined
  const view: FooterTokenChip = {
    input: formatTokenCount(inTok),
    output: formatTokenCount(outTok),
  }
  const now = input.now ?? Date.now()
  if (input.parts !== undefined) {
    const { steps, sawStepPart } = parseStepTokenWindows(input.parts, now)
    if (sawStepPart) {
      const totals = stepDecodeTotals(steps)
      const seconds = totals.ms / 1000
      if (totals.tokens > 0 && seconds >= RATE_MIN_ELAPSED_SECONDS) {
        view.rate = formatTokenRate(totals.tokens / seconds)
      }
      return view
    }
  }
  if (input.startedAt !== undefined && outTok > 0) {
    const elapsed = Math.max(0, (now - input.startedAt) / 1000)
    if (elapsed >= RATE_MIN_ELAPSED_SECONDS) {
      view.rate = formatTokenRate(outTok / elapsed)
    }
  }
  return view
}

export type FooterContextGaugeTone = "muted" | "warning" | "error"
export type FooterContextGauge = { ratio: number; percent: number; tone: FooterContextGaugeTone }

// Context-window usage for the footer gauge (ADR-031 R8). Undefined when
// no usable limit is known or no tokens have accumulated — the caller
// hides the gauge entirely rather than guessing.
//
// Denominator is the compaction budget (SessionCompaction's usable input
// tokens) when available, so 100% means "the next turn triggers
// auto-compaction" and the warning/error tones actually fire. With
// auto-compaction disabled the raw input cap is used instead. Only when
// the budget can't be computed (no model limits) do we fall back to the
// advertised context limit.
export function footerContextGauge(input: {
  totalTokens?: number
  contextLimit?: number
  budget?: CompactionBudget
  compactionAuto?: boolean
}): FooterContextGauge | undefined {
  const total = input.totalTokens ?? 0
  const limit = compactionGaugeLimit({ budget: input.budget, auto: input.compactionAuto }) ?? input.contextLimit ?? 0
  if (total <= 0 || limit <= 0) return undefined
  const ratio = Math.min(1, total / limit)
  const percent = Math.round(ratio * 100)
  const tone: FooterContextGaugeTone = ratio >= 0.95 ? "error" : ratio >= 0.8 ? "warning" : "muted"
  return { ratio, percent, tone }
}

function footerToolLabel(tool: string) {
  const normalized = tool.replace(/[_-]+/g, " ").trim()
  return Locale.titlecase(normalized || "tool")
}

function shortFooterText(value: string, max = 32) {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max - 3)}...`
}

function goalStatusLabel(status: FooterGoalStatus) {
  switch (status) {
    case "active":
      return "Goal"
    case "paused":
      return "Goal paused"
    case "complete":
      return "Goal complete"
    case "blocked":
      return "Goal blocked"
    case "budget_limited":
      return "Goal budget"
  }
}

export function footerGoalChip(input: {
  goal?: FooterGoalInfo | null
  maxObjective?: number
}): FooterGoalChip | undefined {
  const goal = input.goal
  if (!goal) return

  const status = goalStatusLabel(goal.status)
  const objective = shortFooterText(goal.objective, input.maxObjective ?? 36)
  const tokens =
    goal.tokenBudget === undefined || goal.tokensUsed === undefined
      ? ""
      : ` · ${formatTokenCount(goal.tokensUsed)}/${formatTokenCount(goal.tokenBudget)} tok`
  // Don't hint "/goal resume" once the token budget is exhausted — resuming
  // such a goal is refused server-side, so the hint would point at an action
  // that errors. The goal can still be cleared or replaced.
  const budgetExhausted = goal.tokenBudget !== undefined && (goal.remainingTokens ?? 0) <= 0
  const resumeHint =
    (goal.status === "paused" || goal.status === "blocked") && !budgetExhausted ? "/goal resume" : undefined
  const resume = resumeHint ? ` · ${resumeHint}` : ""
  const tone: FooterSessionStatusTone =
    goal.status === "complete" ? "success" : goal.status === "active" ? "working" : "warning"

  return {
    label: `${status}: ${objective}${tokens}${resume}`,
    tone,
    resumeHint,
  }
}

function lowerFirst(value: string) {
  if (!value) return value
  return `${value.charAt(0).toLowerCase()}${value.slice(1)}`
}

function footerTaskLabel(tool?: string) {
  if (!tool) return "Using tool"

  const normalized = tool.replace(/[_-]+/g, " ").trim().toLowerCase()
  if (normalized.includes("todo")) return "Updating todos"
  if (
    ["lsp", "code intelligence", "codesearch", "impact analyze", "debug analyze"].some((name) =>
      normalized.includes(name),
    )
  )
    return "Analyzing code"
  if (["grep", "glob", "ls", "list", "read", "scan"].some((name) => normalized.includes(name))) return "Scanning files"
  if (["bash", "shell", "terminal", "command"].some((name) => normalized.includes(name))) return "Running command"
  if (["edit", "write", "patch", "diff", "refactor apply"].some((name) => normalized.includes(name)))
    return "Editing files"
  if (["task", "agent", "subagent"].some((name) => normalized.includes(name))) return "Subtask"
  if (["web", "fetch", "search"].some((name) => normalized.includes(name))) return "Searching web"
  if (["plan", "hypothesis"].some((name) => normalized.includes(name))) return "Planning"
  if (normalized.includes("question")) return "Input needed"
  if (normalized.includes("skill")) return "Loading skill"
  if (normalized.includes("memory")) return "Saving memory"
  if (normalized.includes("batch")) return "Running tools"

  return `Running ${footerToolLabel(tool)}`
}

export function footerSessionStatusView(input: {
  status?: FooterSessionStatus
  now?: number
  stalledAfterMs?: number
}): FooterSessionStatusView {
  const status = input.status
  if (!status || status.type === "idle") return { stale: false, tone: "muted" }

  const now = input.now ?? Date.now()

  if (status.type === "retry") {
    const remaining = Math.max(0, Math.round((status.next - now) / MS_PER_SECOND))
    const duration = formatDuration(remaining)
    return {
      label: duration ? `Retrying in ${duration}` : "Retrying",
      stale: false,
      tone: "warning",
    }
  }

  const elapsedSeconds =
    status.startedAt !== undefined ? Math.max(1, Math.floor((now - status.startedAt) / MS_PER_SECOND)) : undefined
  const elapsed = elapsedSeconds !== undefined ? formatDuration(elapsedSeconds) : ""

  let label = "Thinking"
  if (status.waitState === "tool") {
    label = footerTaskLabel(status.activeTool)
  } else if (status.waitState === "llm") {
    label = "Thinking"
  }

  const staleAfterMs =
    input.stalledAfterMs ??
    (status.waitState === "tool" ? SESSION_STATUS_TOOL_STALE_AFTER_MS : SESSION_STATUS_STALE_AFTER_MS)
  const idleMs = status.lastActivityAt !== undefined ? Math.max(0, now - status.lastActivityAt) : 0
  const stale = idleMs >= staleAfterMs
  const inactive = stale && idleMs > 0 ? formatDuration(Math.max(1, Math.floor(idleMs / MS_PER_SECOND))) : undefined
  const text = elapsed ? `${label} · ${elapsed}` : label

  if (!inactive) return { label: text, stale, tone: stale ? "warning" : "working" }

  // Tool waits do not emit periodic progress heartbeats, so presenting
  // `inactive` as a second timer mostly duplicates the elapsed duration.
  // The warning marker and "Still..." copy already surface the stale state.
  const staleHint = status.waitState ? undefined : `Inactive ${inactive}`
  const waitingText =
    status.waitState === "tool"
      ? `Still ${lowerFirst(label)}`
      : status.waitState === "llm"
        ? "Still waiting for model"
        : "Still working"
  const waiting = elapsed ? `${waitingText} · ${elapsed}` : waitingText
  const labelWithHint = staleHint ? `${waiting} · ${staleHint}` : waiting

  return {
    label: labelWithHint,
    stale,
    tone: "warning",
  }
}

function isFooterSessionStatus(value: unknown): value is FooterSessionStatus {
  if (!value || typeof value !== "object") return false
  const status = value as Record<string, unknown>
  if (status.type === "idle") return true
  if (status.type === "retry") {
    return typeof status.attempt === "number" && typeof status.message === "string" && typeof status.next === "number"
  }
  if (status.type === "busy") return true
  return false
}

export function footerSessionStatusOrIdle(value: unknown): FooterSessionStatus {
  return isFooterSessionStatus(value) ? value : { type: "idle" }
}

// Subagents (/goal planning, the task tool) run in child sessions, so the
// parent session reports "idle" while they work. The footer must not render
// "Finished" until every child session in the tree has settled.
export function hasActiveSubagentInSessionTree(input: {
  sessions: readonly { id: string; parentID?: string }[]
  statuses?: Record<string, { type: string } | undefined>
  parentSessionID: string
}): boolean {
  return input.sessions.some((session) => {
    if (session.parentID !== input.parentSessionID) return false
    const status = input.statuses?.[session.id]
    return status !== undefined && status.type !== "idle"
  })
}

function subagentActivityTime(status: FooterSessionStatus) {
  if (status.type === "busy") return status.lastActivityAt ?? status.startedAt ?? 0
  if (status.type === "retry") return status.next
  return 0
}

// While subagents work, the parent's own status stays "idle" and the footer
// would otherwise render nothing — no spinner, no label, no elapsed time.
// Project the most recently active child session into the same busy-style
// footer view the parent's own status gets, prefixed with the subagent
// count, so the footer keeps showing live progress for the whole tree.
export function footerSubagentStatusView(input: {
  sessions: readonly { id: string; parentID?: string }[]
  statuses?: Record<string, FooterSessionStatus | undefined>
  parentSessionID: string
  now?: number
}): (FooterSessionStatusView & { running: number }) | undefined {
  const now = input.now ?? Date.now()
  const active: FooterSessionStatus[] = []
  for (const session of input.sessions) {
    if (session.parentID !== input.parentSessionID) continue
    const status = input.statuses?.[session.id]
    if (!status || status.type === "idle") continue
    active.push(status)
  }
  if (active.length === 0) return undefined

  // A busy child is more informative than a retrying one; within the busy
  // group, the child with the freshest activity is the one the user is
  // most likely watching.
  const busy = active.filter((status) => status.type === "busy")
  const representative =
    busy.length > 0 ? busy.reduce((a, b) => (subagentActivityTime(a) >= subagentActivityTime(b) ? a : b)) : active[0]
  const view = footerSessionStatusView({ status: representative, now })
  const prefix = active.length === 1 ? "Subagent" : `${active.length} subagents`
  return {
    ...view,
    label: view.label ? `${prefix}: ${view.label}` : prefix,
    running: active.length,
  }
}
