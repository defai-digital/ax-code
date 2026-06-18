export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try {
    return String(error)
  } catch {
    return "Unknown error"
  }
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(toErrorMessage(error))
}
