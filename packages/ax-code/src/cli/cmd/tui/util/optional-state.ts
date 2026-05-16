type ErrorWithCode = {
  code?: unknown
}

const OPTIONAL_STATE_SUPPRESSED_CODES = new Set(["ENOENT", "EACCES", "EPERM", "EROFS"])

export function optionalStateErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) return undefined
  const code = (error as ErrorWithCode).code
  return typeof code === "string" ? code : undefined
}

export function isOptionalStateUnavailableError(error: unknown): boolean {
  const code = optionalStateErrorCode(error)
  return code !== undefined && OPTIONAL_STATE_SUPPRESSED_CODES.has(code)
}

export function shouldSurfaceOptionalStateError(error: unknown): boolean {
  return !isOptionalStateUnavailableError(error)
}

export function optionalStateErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
