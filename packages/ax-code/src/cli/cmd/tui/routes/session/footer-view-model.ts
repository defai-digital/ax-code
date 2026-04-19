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

export function footerPermissionLabel(count: number): string | undefined {
  if (count <= 0) return
  return `${count} Permission${count > 1 ? "s" : ""}`
}

function footerToolLabel(tool: string) {
  const normalized = tool.replace(/[_-]+/g, " ").trim()
  return Locale.titlecase(normalized || "tool")
}

export function footerSessionStatusLabel(input: {
  status?: FooterSessionStatus
  now?: number
}): string | undefined {
  const status = input.status
  if (!status || status.type === "idle") return

  const now = input.now ?? Date.now()

  if (status.type === "retry") {
    const remaining = Math.max(0, Math.round((status.next - now) / 1000))
    const duration = formatDuration(remaining)
    return duration ? `Retrying in ${duration}` : "Retrying"
  }

  const elapsedSeconds =
    status.startedAt !== undefined ? Math.max(1, Math.floor((now - status.startedAt) / 1000)) : undefined
  const elapsed = elapsedSeconds !== undefined ? formatDuration(elapsedSeconds) : ""

  let label = "Working"
  if (status.waitState === "tool") {
    label = status.activeTool ? `Running ${footerToolLabel(status.activeTool)}` : "Running tool"
  } else if (status.waitState === "llm") {
    label = "Waiting for model"
  }

  return elapsed ? `${label} · ${elapsed}` : label
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
      label: "Trust ready",
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
