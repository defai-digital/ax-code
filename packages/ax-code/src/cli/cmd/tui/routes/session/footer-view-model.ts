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

  return {
    label: `${text} · ${staleHint}`,
    shortLabel: status.waitState === "llm" ? "Thinking stalled" : "Processing stalled",
    stale,
    tone: "warning",
  }
}

export function sidebarSessionStatusView(input: {
  status?: FooterSessionStatus
  hasMessages: boolean
  pendingTodos?: number
  now?: number
}): FooterSessionStatusView & { label: string } {
  if (!input.status || input.status.type === "idle") {
    if (input.hasMessages && input.pendingTodos && input.pendingTodos > 0) {
      const label = input.pendingTodos === 1 ? "1 todo left" : `${input.pendingTodos} todos left`
      return {
        label,
        shortLabel: label,
        stale: false,
        tone: "warning",
      }
    }
    return {
      label: input.hasMessages ? "Finished" : "Ready",
      shortLabel: input.hasMessages ? "Finished" : "Ready",
      stale: false,
      tone: input.hasMessages ? "success" : "muted",
    }
  }

  const view = footerSessionStatusView({
    status: input.status,
    now: input.now,
  })

  return {
    ...view,
    label: view.shortLabel ?? view.label ?? "Working",
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
