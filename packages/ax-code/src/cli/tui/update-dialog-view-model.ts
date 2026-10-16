// Pure state for the update dialog. The dialog component only renders these
// states and forwards actions, so the transitions are testable without a TUI.

export type UpdateCheckReport = {
  current: string
  latest: string | null
  upToDate: boolean | null
  method: "curl" | "brew" | "unknown"
  releaseType?: "patch" | "minor" | "major" | "unknown"
  error?: string
}

export type UpdateDialogState =
  | { type: "checking" }
  | { type: "current"; version: string }
  | { type: "available"; current: string; latest: string }
  | { type: "installing"; version: string }
  | { type: "installed"; version: string; warnings: readonly string[] }
  | { type: "check-failed"; message: string }
  | { type: "install-failed"; message: string; latest: string }

export type UpdateDialogAction = "install" | "retry-check" | "retry-install" | "exit" | "none"

export function updateStateFromCheck(report: UpdateCheckReport): UpdateDialogState {
  if (report.error) return { type: "check-failed", message: report.error }
  if (report.upToDate === false && report.latest) {
    return { type: "available", current: report.current, latest: report.latest }
  }
  if (report.upToDate) return { type: "current", version: report.current }
  return { type: "check-failed", message: "The latest version could not be determined." }
}

export function updateStateFromAvailable(current: string, latest: string): UpdateDialogState {
  return { type: "available", current, latest }
}

export type UpgradeResponse = {
  data?: { success: true; version: string; warnings?: string[] } | { success: false; error: string }
  error?: unknown
}

export function updateStateFromUpgrade(
  latest: string,
  response: UpgradeResponse,
  describeError: (error: unknown) => string,
): UpdateDialogState {
  const data = response.data
  if (!response.error && data && data.success) {
    return { type: "installed", version: data.version, warnings: data.warnings ?? [] }
  }
  const message = data && !data.success ? data.error : describeError(response.error)
  return { type: "install-failed", message, latest }
}

// Enter runs the primary action for the current state.
export function primaryUpdateAction(state: UpdateDialogState): UpdateDialogAction {
  switch (state.type) {
    case "available":
      return "install"
    case "check-failed":
      return "retry-check"
    case "install-failed":
      return "retry-install"
    case "installed":
      return "exit"
    default:
      return "none"
  }
}
