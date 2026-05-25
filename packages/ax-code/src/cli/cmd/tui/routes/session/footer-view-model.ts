import { formatDuration } from "@/util/format"
import { Locale } from "@/util/locale"

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
      startedAt?: number
      lastActivityAt?: number
      activeTool?: string
      toolCallID?: string
      waitState?: "llm" | "tool"
    }

type FooterSessionStatusTone = "muted" | "working" | "success" | "warning"

type FooterSessionStatusView = {
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
function formatTokenCount(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  return `${Math.round(n / 1000)}k`
}

// Sub-second rates are noisy and meaningless ("inf t/s" right after the
// first token lands) — gate rate calc on a real elapsed window. Anything
// shorter than this returns no rate; the caller hides the suffix.
const RATE_MIN_ELAPSED_SECONDS = 0.5

// Build the per-turn token chip view from the most-recent assistant
// message plus the current turn's start timestamp. Rate is OUTPUT
// tokens per second — that's what the user sees "happening" during a
// stream. Returns `rate` undefined when the turn is settled (startedAt
// not supplied), when there's no meaningful elapsed window yet, or
// when there are no output tokens to report against.
export function footerTokenChip(input: {
  tokens?: { input?: number; output?: number }
  startedAt?: number
  now?: number
}): FooterTokenChip | undefined {
  const inTok = input.tokens?.input ?? 0
  const outTok = input.tokens?.output ?? 0
  if (inTok <= 0 && outTok <= 0) return undefined
  const view: FooterTokenChip = {
    input: formatTokenCount(inTok),
    output: formatTokenCount(outTok),
  }
  if (input.startedAt !== undefined && outTok > 0) {
    const now = input.now ?? Date.now()
    const elapsed = Math.max(0, (now - input.startedAt) / 1000)
    if (elapsed >= RATE_MIN_ELAPSED_SECONDS) {
      const rate = outTok / elapsed
      view.rate = rate >= 100 ? `${Math.round(rate)} t/s` : `${rate.toFixed(1)} t/s`
    }
  }
  return view
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
  const resumeHint = goal.status === "paused" || goal.status === "blocked" ? "/goal resume" : undefined
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

  const staleHint =
    status.waitState === "tool"
      ? `no tool update · ${inactive}`
      : status.waitState === "llm"
        ? undefined
        : `Inactive ${inactive}`
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
