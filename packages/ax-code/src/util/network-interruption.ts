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

// Retain only the opaque gateway correlation ID, never the response headers.
// A WeakMap preserves the original error identity, including frozen errors.
const requestIDs = new WeakMap<Error, string>()

export function rememberNetworkRequestID(error: unknown, headers: Headers): void {
  const id = headers.get("x-request-id")
  if (error instanceof Error && id && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
    requestIDs.set(error, id) // @scan-suppress lifecycle_scan: WeakMap keys do not retain errors.
  }
}

export function networkInterruptionRequestID(error: unknown): string | undefined {
  let current = error
  for (let depth = 0; depth < 6 && current instanceof Error; depth++) {
    const id = requestIDs.get(current)
    if (id) return id
    current = current.cause
  }
  return undefined
}

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

// undici's connect deadline: the server never accepted the connection.
const CONNECT_TIMEOUT_CODE = "UND_ERR_CONNECT_TIMEOUT"
// How many nested `cause`s `isServerUnreachable` inspects below the error itself.
const UNREACHABLE_CAUSE_DEPTH = 5

/**
 * Whether a request error means the server could not be reached at all: a
 * connection-level failure (refused, DNS, unreachable network, dropped socket)
 * or a deadline (`AbortSignal.timeout`, undici's connect timeout) anywhere in
 * the `cause` chain. A dual-stack connect failure arrives as an AggregateError
 * and counts when every attempt was unreachable. A server that answered with
 * an HTTP status, malformed JSON or an unusable payload was reachable.
 */
export function isServerUnreachable(error: unknown, depth = 0): boolean {
  let current = error
  for (; depth <= UNREACHABLE_CAUSE_DEPTH && current instanceof Error; depth++) {
    if (current.name === "TimeoutError") return true
    const code = (current as NodeJS.ErrnoException).code
    if (code === CONNECT_TIMEOUT_CODE || (code && INTERRUPTION_CODES.has(code))) return true
    if (current instanceof TypeError && UNDICI_TERMINATED_MESSAGES.has(current.message)) return true
    if (current instanceof AggregateError && current.errors.length > 0) {
      const next = depth + 1
      if (current.errors.every((inner) => isServerUnreachable(inner, next))) return true
    }
    current = current.cause
  }
  return false
}
