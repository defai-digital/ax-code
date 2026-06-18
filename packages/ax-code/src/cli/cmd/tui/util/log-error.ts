export function formatTuiLogError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return "Unknown TUI error"
  }
}

export function formatWorkerLoadError(target: string, error: unknown): string {
  const message =
    typeof ErrorEvent !== "undefined" && error instanceof ErrorEvent ? error.message : formatTuiLogError(error)
  return `Worker failed to load (${target}): ${message}`
}
