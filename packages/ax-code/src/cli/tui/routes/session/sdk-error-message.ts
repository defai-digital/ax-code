// The v2 SDK client resolves `{error}` instead of rejecting; extract a
// human-readable message from whatever shape the server returned.
export function sdkErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error) return error
  if (typeof error === "object" && error) {
    const candidate = error as { data?: { message?: string }; message?: string }
    return candidate.data?.message ?? candidate.message ?? fallback
  }
  return fallback
}
