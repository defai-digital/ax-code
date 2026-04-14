export type FooterMcpStatus = "connected" | "failed" | "needs_auth" | "needs_client_registration" | string

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

