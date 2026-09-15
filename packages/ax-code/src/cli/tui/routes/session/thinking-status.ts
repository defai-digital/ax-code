/**
 * Whether the per-message "Thinking" spinner should animate.
 * Requires an active session status (busy/retry) so a stopped/idle/error run
 * never leaves a spinner spinning on an incomplete last assistant message (#378).
 */
export function isAssistantThinkingActive(input: {
  sessionStatusType?: string
  messageError?: unknown
  hasParts: boolean
  isFinal: boolean
  isLast: boolean
}): boolean {
  if (input.sessionStatusType !== "busy" && input.sessionStatusType !== "retry") return false
  if (input.messageError) return false
  if (input.hasParts) return false
  if (input.isFinal) return false
  if (!input.isLast) return false
  return true
}
