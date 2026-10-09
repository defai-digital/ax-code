/** Raised when a response body crosses the caller's byte cap. */
export class BodyTooLargeError extends Error {
  constructor(readonly limit: number) {
    super(`Response body exceeds the ${limit} byte limit`)
    this.name = "BodyTooLargeError"
  }
}

/**
 * Buffer a response body while enforcing a byte cap on the stream. Bounds
 * chunked responses that omit or misreport `Content-Length`; callers that
 * precheck the header stay in charge of that check. The reader is always
 * released, and is cancelled when the cap is crossed, so a rejected body
 * never leaves its lock or socket held.
 */
export async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) throw new Error("Response has no body")
  try {
    const chunks: Uint8Array[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => {})
        throw new BodyTooLargeError(maxBytes)
      }
      chunks.push(value)
    }
    const body = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      body.set(chunk, offset)
      offset += chunk.byteLength
    }
    return body
  } finally {
    reader.releaseLock()
  }
}
