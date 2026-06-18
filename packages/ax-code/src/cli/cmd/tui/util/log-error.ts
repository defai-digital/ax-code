export function formatTuiLogError(error: unknown): string {
  try {
    return String(error)
  } catch {
    return "Unknown TUI error"
  }
}
