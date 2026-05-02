import { formatDuration } from "@/util/format"
import { Locale } from "@/util/locale"

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
  return `${count} Permission${count > 1 ? "s" : ""}`
}

function footerToolLabel(tool: string) {
  const normalized = tool.replace(/[_-]+/g, " ").trim()
  return Locale.titlecase(normalized || "tool")
}

export function footerSessionStatusView(input: {
  status?: FooterSessionStatus
  now?: number
  stalledAfterMs?: number
  model?: string
  interruptHint?: string
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

  let label = "Working"
  let shortLabel = "Processing..."
  if (status.waitState === "tool") {
    label = status.activeTool ? `Running ${footerToolLabel(status.activeTool)}` : "Running tool"
    shortLabel = status.activeTool ? `Running ${footerToolLabel(status.activeTool)}` : "Running tool"
  } else if (status.waitState === "llm") {
    label = "Waiting for response"
    shortLabel = "Thinking..."
  }

  const staleAfterMs =
    input.stalledAfterMs ??
    (status.waitState === "tool" ? SESSION_STATUS_TOOL_STALE_AFTER_MS : SESSION_STATUS_STALE_AFTER_MS)
  const idleMs = status.lastActivityAt !== undefined ? Math.max(0, now - status.lastActivityAt) : 0
  const stale = idleMs >= staleAfterMs
  const inactive = stale && idleMs > 0 ? formatDuration(Math.max(1, Math.floor(idleMs / MS_PER_SECOND))) : undefined
  const text = elapsed ? `${label} · ${elapsed}` : label

  if (!inactive) return { label: text, shortLabel, stale, tone: stale ? "warning" : "working" }

  // Give context-aware stale messages instead of generic "no activity"
  const staleHint =
    status.waitState === "tool"
      ? `tool may be stalled · ${inactive}`
      : status.waitState === "llm"
        ? `response delayed · ${inactive}`
        : `no update · ${inactive}`

  const stallWho = input.model ?? (status.waitState === "llm" ? "Thinking" : "Processing")
  const interruptSuffix = input.interruptHint ? ` · ${input.interruptHint} to cancel` : ""
  return {
    label: `${text} · ${staleHint}`,
    shortLabel: `${stallWho} stalled${interruptSuffix}`,
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
      label: `${input.pendingPlans} Plan${input.pendingPlans !== 1 ? "s" : ""}`,
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
