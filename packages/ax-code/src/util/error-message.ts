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

/** Extract `.code` from an unknown error value (e.g. NodeJS.ErrnoException). */
export function errorCode(error: unknown): string | undefined {
  if (error instanceof Error) return (error as NodeJS.ErrnoException).code
  return undefined
}
