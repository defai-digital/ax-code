export function toErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return fallback
  }
}
