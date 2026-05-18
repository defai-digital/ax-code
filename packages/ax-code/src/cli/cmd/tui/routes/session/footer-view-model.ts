import { formatDuration } from "@/util/format"
import { Locale } from "@/util/locale"
import type { AgentControlSummary } from "@/control-plane/agent-control-summary"
import type { ToolCallReplayQuery } from "@/replay/tool-call-query"

export type FooterMcpStatus = "connected" | "failed" | "needs_auth" | "needs_client_registration" | string
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

export type FooterSessionStatusTone = "muted" | "working" | "success" | "warning"

export type FooterSessionStatusView = {
  label?: string
  shortLabel?: string
  stale: boolean
  tone: FooterSessionStatusTone
}

export type FooterAgentControlStatusView = {
  label: string
  tone: FooterSessionStatusTone
}

export type FooterTrustChip =
  | {
      type: "plans"
      label: string
      count: number
    }
  | {
      type: "ready"
      label: string
      count: 0
    }

export const SESSION_STATUS_STALE_AFTER_MS = 60_000
export const SESSION_STATUS_TOOL_STALE_AFTER_MS = 90_000
const MS_PER_SECOND = 1_000

export function footerPermissionLabel(count: number): string | undefined {
  if (count <= 0) return
  return Locale.pluralize(count, "{} Permission", "{} Permissions")
}

export type FooterTokenChip = { input: string; output: string; rate?: string }

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
  if (["task", "agent", "subagent"].some((name) => normalized.includes(name))) return "Running subtask"
  if (["web", "fetch", "search"].some((name) => normalized.includes(name))) return "Searching web"
  if (["plan", "hypothesis"].some((name) => normalized.includes(name))) return "Planning changes"
  if (normalized.includes("question")) return "Waiting for input"
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
      shortLabel: duration ? `Retrying in ${duration}` : "Retrying",
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

  if (!inactive) return { label: text, shortLabel: text, stale, tone: stale ? "warning" : "working" }

  const staleHint =
    status.waitState === "tool"
      ? `no tool update ${inactive}`
      : status.waitState === "llm"
        ? undefined
        : `no activity ${inactive}`
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
    shortLabel: labelWithHint,
    stale,
    tone: "warning",
  }
}

export function footerSessionStatusLabel(input: {
  status?: FooterSessionStatus
  now?: number
  stalledAfterMs?: number
}): string | undefined {
  return footerSessionStatusView(input).label
}

export function footerAgentControlStatusView(
  summary?: AgentControlSummary.Summary,
  tools?: ToolCallReplayQuery.Summary,
): FooterAgentControlStatusView | undefined {
  if (tools && tools.openTaskCalls.length > 0) {
    return {
      label: `Agent waiting: ${Locale.pluralize(tools.openTaskCalls.length, "{} subagent", "{} subagents")}`,
      tone: summary?.completed ? "warning" : "working",
    }
  }
  if (tools && tools.openCalls.length > 0) {
    return {
      label: `Agent waiting: ${Locale.pluralize(tools.openCalls.length, "{} tool result", "{} tool results")}`,
      tone: summary?.completed ? "warning" : "working",
    }
  }
  if (!summary) return
  if (summary.completed) {
    return {
      label: "Agent complete",
      tone: "success",
    }
  }
  if (summary.blockedReason) {
    return {
      label: `Agent blocked: ${shortFooterText(summary.blockedReason, 28)}`,
      tone: "warning",
    }
  }

  const parts: string[] = []
  if (summary.phase) parts.push(Locale.titlecase(summary.phase.replace(/_/g, " ")))
  if (summary.reasoningDepth === "deep" || summary.reasoningDepth === "xdeep") {
    parts.push(`${summary.reasoningDepth} reasoning`)
  }
  if (summary.plan) {
    parts.push(`plan ${summary.plan.progress.completed}/${summary.plan.progress.total}`)
  }
  if (summary.safety.shadow > 0) {
    parts.push(`shadow safety ${summary.safety.shadow}`)
  }
  if (parts.length === 0) return

  return {
    label: `Agent ${parts.join(" · ")}`,
    tone: summary.safety.ask > 0 || summary.safety.deny > 0 ? "warning" : "working",
  }
}

export function footerMcpView(statuses: FooterMcpStatus[]) {
  return {
    connected: statuses.filter((status) => status === "connected").length,
    hasError: statuses.some((status) => status === "failed"),
  }
}

export function footerTrustChip(input: {
  experimentalDebugEngine: boolean
  pendingPlans: number
  graphNodeCount: number
}): FooterTrustChip | undefined {
  if (input.pendingPlans > 0) {
    return {
      type: "plans",
      label: Locale.pluralize(input.pendingPlans, "{} Plan", "{} Plans"),
      count: input.pendingPlans,
    }
  }
  if (input.experimentalDebugEngine && input.graphNodeCount > 0) {
    return {
      type: "ready",
      label: "DRE ready",
      count: 0,
    }
  }
  return
}

export function footerSandboxView(mode: string) {
  return {
    label: mode === "full-access" ? "sandbox off" : "sandbox on",
    risk: mode === "full-access" ? "danger" : "safe",
  } as const
}

export function isFooterSessionStatus(value: unknown): value is FooterSessionStatus {
  if (!value || typeof value !== "object") return false
  const status = value as Record<string, unknown>
  if (status.type === "idle") return true
  if (status.type === "retry") {
    return typeof status.attempt === "number" && typeof status.message === "string" && typeof status.next === "number"
  }
  if (status.type === "busy") return true
  return false
}

export type FooterProgressBarView = {
  filled: string
  empty: string
  label: string
  percent: number
  stale: boolean
  overSoftMax: boolean
}

const PROGRESS_BAR_WIDTH = 10
const PROGRESS_MIN_TERMINAL_WIDTH = 80
// Soft target — the bar fills relative to this, not the global hard cap
// (typically 500). 50 covers ordinary task density (a ~5-10 task batch);
// reaching it means "this run is unusually long" and the bar flips to a
// warning tone. The hard cap stays in `status.maxSteps` for correctness
// but is intentionally hidden from the bar's visual scale because a
// 4/500 bar reads as empty and gives users no useful feedback.
export const PROGRESS_SOFT_MAX = 50

// Pure data-driven progress bar derived from step/maxSteps in the session
// status. Re-renders only when those values change — there is no internal
// timer, no animation frame, and no shimmer cell. v2's earlier "animated
// usage bar" used a 120ms setInterval driving a moving cell, which was a
// known TUI hang vector under opentui + compiled-binary rendering. This
// helper deliberately avoids that pattern.
export function footerProgressBar(input: {
  status?: FooterSessionStatus
  terminalWidth?: number
  stale?: boolean
  softMax?: number
}): FooterProgressBarView | undefined {
  const status = input.status
  if (!status || status.type !== "busy") return
  if (status.step === undefined || status.maxSteps === undefined) return
  if (status.maxSteps <= 0) return
  if (input.terminalWidth !== undefined && input.terminalWidth < PROGRESS_MIN_TERMINAL_WIDTH) return

  const softMax = input.softMax ?? PROGRESS_SOFT_MAX
  const overSoftMax = status.step > softMax
  // Visual fill scales against softMax and clamps at 100% — a "long-run"
  // task pegs the bar full and the warning tone communicates the overrun.
  const ratio = Math.max(0, Math.min(1, status.step / softMax))
  const fillCells = Math.max(0, Math.min(PROGRESS_BAR_WIDTH, Math.round(ratio * PROGRESS_BAR_WIDTH)))
  return {
    filled: "█".repeat(fillCells),
    empty: "░".repeat(PROGRESS_BAR_WIDTH - fillCells),
    label: `${status.step}`,
    percent: Math.round(ratio * 100),
    stale: input.stale ?? false,
    overSoftMax,
  }
}
