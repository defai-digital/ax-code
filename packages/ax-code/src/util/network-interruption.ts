// Errno and undici/HTTP2 codes that mark a connection dropped by the peer or
// the network. undici puts them on the `cause` of its fetch TypeError, e.g.
// `TypeError: terminated` caused by NGHTTP2_INTERNAL_ERROR on a stream reset.
const INTERRUPTION_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ERR_HTTP2_STREAM_ERROR",
  "ERR_HTTP2_SESSION_ERROR",
  "ERR_HTTP2_STREAM_CANCEL",
  "ERR_HTTP2_GOAWAY_SESSION",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
])

// undici's exact TypeError messages for a response body cut off by the peer.
// Exact equality so provider messages that merely contain the word stay
// unclassified.
const UNDICI_TERMINATED_MESSAGES = new Set(["terminated", "other side closed"])

/** First error in the `cause` chain carrying a connection-interruption code. */
export function networkInterruptionCause(error: unknown): Error | undefined {
  let cause = error instanceof Error ? error.cause : undefined
  for (let depth = 0; depth < 5 && cause instanceof Error; depth++) {
    const code = (cause as NodeJS.ErrnoException).code
    if (code && INTERRUPTION_CODES.has(code)) return cause
    cause = cause.cause
  }
  return undefined
}

/**
 * undici fetch failures whose top-level message and code say nothing useful:
 * a bare "terminated" / "other side closed" TypeError, or any error whose
 * cause chain carries a socket or HTTP/2 interruption code.
 */
export function isNetworkInterruption(error: unknown): boolean {
  if (error instanceof TypeError && UNDICI_TERMINATED_MESSAGES.has(error.message)) return true
  return networkInterruptionCause(error) !== undefined
}
