export function formatTuiLogError(error: unknown): string {
  try {
    if (error instanceof Error) {
      // These messages get pasted into bug reports — keep the stack and any
      // cause chain instead of flattening to "Name: message".
      const base = error.stack ?? `${error.name}: ${error.message}`
      if (error.cause === undefined) return base
      return `${base}\nCaused by: ${formatTuiLogError(error.cause)}`
    }
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
