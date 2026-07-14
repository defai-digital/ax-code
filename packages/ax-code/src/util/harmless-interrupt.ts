import { toErrorMessage } from "./error-message"

const INTERRUPTED_WITHOUT_ERROR = "All fibers interrupted without error"

/**
 * Returns true for cancellations / aborts / broken-pipe noise that should not
 * crash the CLI or TUI process. Real application failures return false.
 *
 * Used by:
 * - CLI boot unhandledRejection / uncaughtException handlers
 * - TUI crash handlers
 * - Worker process fault handlers
 * - Project dispose paths
 */
export function isHarmlessInterrupt(reason: unknown): boolean {
  if (reason == null) return false

  if (typeof reason === "object") {
    const rec = reason as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown }

    const name = typeof rec.name === "string" ? rec.name : ""
    if (name === "AbortError" || name === "TimeoutError" || name === "CanceledError") return true

    const code = typeof rec.code === "string" ? rec.code : typeof rec.code === "number" ? String(rec.code) : ""
    // User closed the terminal, stream destroyed mid-write, connection reset on cancel.
    if (
      code === "EPIPE" ||
      code === "ECONNRESET" ||
      code === "ERR_STREAM_DESTROYED" ||
      code === "ERR_STREAM_PREMATURE_CLOSE" ||
      code === "ABORT_ERR"
    ) {
      return true
    }

    // Nested cause (e.g. fetch wrappers)
    if (rec.cause != null && rec.cause !== reason && isHarmlessInterrupt(rec.cause)) return true
  }

  const message = toErrorMessage(reason)
  if (!message) return false
  if (message === INTERRUPTED_WITHOUT_ERROR) return true

  const lower = message.toLowerCase()
  if (lower === "aborted" || lower === "abort" || lower === "cancelled" || lower === "canceled") return true
  if (lower === "this operation was aborted" || lower === "the operation was aborted") return true
  if (lower.includes("all fibers interrupted")) return true
  // Keep bounded: only short abort-ish messages, not arbitrary "aborted plan" content.
  if (lower.length <= 96 && (lower.includes("aborted") || lower.includes("abort error"))) return true
  if (lower.includes("operation was aborted") || lower.includes("request was aborted")) return true

  return false
}
