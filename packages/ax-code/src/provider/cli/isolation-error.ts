/**
 * Stable identity for a CLI provider that cannot enforce the session's
 * isolation mode.
 *
 * Kept in a dependency-free module so the session layer (error
 * serialization, processor retry, prompt loop) can recognize the failure
 * without importing the config-dependent isolation argv mapper. That matters
 * because the error reaches the prompt loop as a serialized assistant-message
 * error, not as the live class instance.
 */
export const CLI_ISOLATION_UNSUPPORTED_ERROR_NAME = "CliIsolationUnsupportedError"

/**
 * Stable marker carried by every CLI isolation failure message. The error
 * name survives in the live instance and the serialized `{name, data}` shape,
 * but a generic serializer can replace the name with `UnknownError`; the
 * message text is the one field that survives every path, so it remains a
 * last-resort classifier.
 */
export const CLI_ISOLATION_UNSUPPORTED_MESSAGE_MARKER = "cannot enforce AX Code's"

/**
 * Machine-readable code persisted on the serialized `APIError` metadata so a
 * later reader does not depend on the message wording.
 */
export const CLI_ISOLATION_UNSUPPORTED_ERROR_CODE = "cli_isolation_unsupported"

/** The single actionable message for a CLI that cannot enforce `mode`. */
export function cliIsolationUnsupportedMessage(label: string, mode: string): string {
  return (
    `${label} ${CLI_ISOLATION_UNSUPPORTED_MESSAGE_MARKER} ${mode} isolation mode; ` +
    "switch to full-access or use a different provider."
  )
}

/**
 * True for the live error, its serialized `{name, data}` form, an `APIError`
 * carrying the isolation metadata code, and the name-lost `UnknownError`
 * fallback — matching the stable message marker when the name is gone.
 */
export function isCliIsolationUnsupportedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  if ((error as { name?: unknown }).name === CLI_ISOLATION_UNSUPPORTED_ERROR_NAME) return true

  const data = (error as { data?: unknown }).data
  if (data && typeof data === "object") {
    if ((data as { name?: unknown }).name === CLI_ISOLATION_UNSUPPORTED_ERROR_NAME) return true
    const metadata = (data as { metadata?: unknown }).metadata
    if (
      metadata &&
      typeof metadata === "object" &&
      (metadata as { errorCode?: unknown }).errorCode === CLI_ISOLATION_UNSUPPORTED_ERROR_CODE
    ) {
      return true
    }
    if (messageHasMarker((data as { message?: unknown }).message)) return true
  }

  return messageHasMarker((error as { message?: unknown }).message)
}

/** The actionable text from a live or serialized CLI isolation failure. */
export function cliIsolationUnsupportedMessageOf(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const data = (error as { data?: unknown }).data
  if (data && typeof data === "object") {
    const dataMessage = (data as { message?: unknown }).message
    if (typeof dataMessage === "string" && dataMessage.length > 0) return dataMessage
  }
  const message = (error as { message?: unknown }).message
  return typeof message === "string" && message.length > 0 ? message : undefined
}

function messageHasMarker(message: unknown): boolean {
  return typeof message === "string" && message.includes(CLI_ISOLATION_UNSUPPORTED_MESSAGE_MARKER)
}
