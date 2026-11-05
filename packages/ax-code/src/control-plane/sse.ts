import { Log } from "@/util/log"
import { parseJsonPayload } from "@/util/json-value"
import { waitForAbort } from "@/util/abort"

const log = Log.create({ service: "control-plane.sse" })
const MAX_SSE_BUFFER_CHARS = 1024 * 1024
const SSE_BLOCK_BOUNDARY = /\r\n\r\n|\r\n\n|\r\n\r|\n\r\n|\r\r\n|\n\n|\n\r|\r\r/

export function sseMessageData(text: string, meta: { id?: string; retry?: number } = {}) {
  return {
    type: "sse.message",
    properties: {
      data: text,
      id: meta.id,
      retry: meta.retry,
    },
  }
}

export function parseSSEJsonData(text: string): unknown | undefined {
  return parseJsonPayload(text)
}

export function parseSSEData(text: string, meta: { id?: string; retry?: number } = {}): unknown {
  return parseSSEJsonData(text) ?? sseMessageData(text, meta)
}

// Each parser invocation owns exactly one reader/buffer pair for one response
// body. Callers must not share a ReadableStream body across concurrent
// parseSSE calls; the stream reader lock is the intended serialization point.
export async function parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: unknown) => void,
  options: { onActivity?: () => void; onEventID?: (id: string) => void } = {},
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let flushTrailing = false
  // Guard against double-cancel: the abort listener and the `finally`
  // block below would both call `reader.cancel()` on a typical aborted
  // exit, and while the `.catch(() => {})` swallows the second-cancel
  // rejection, calling cancel twice on a stream is wasteful and confuses
  // implementations that don't expect it.
  let canceled = false
  const cancel = () => {
    if (canceled) return
    canceled = true
    void reader.cancel().catch(() => {})
  }

  signal.addEventListener("abort", cancel, { once: true })

  const emit = (block: string) => {
    const data: string[] = []
    let id: string | undefined
    let retry: number | undefined

    for (const line of block.split(/\r\n|\r|\n/)) {
      if (!line || line.startsWith(":")) continue
      const idx = line.indexOf(":")
      const key = idx === -1 ? line : line.slice(0, idx)
      const raw = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "")
      if (key === "data") {
        data.push(raw)
        continue
      }
      if (key === "id" && !raw.includes("\0")) {
        id = raw
        continue
      }
      if (key === "retry") {
        // Reject NaN, negative, and Infinity; cap accepted value at 60s.
        // A buggy or malicious server sending `retry: "9".repeat(20)`
        // would otherwise coerce to Infinity, and a downstream
        // setTimeout on an Infinity delay never fires — blocking
        // reconnection forever.
        // The SSE retry field is an integer field; hex, scientific notation,
        // signs, decimals, and surrounding whitespace must be ignored.
        if (/^\d+$/.test(raw)) {
          const val = Number(raw)
          if (Number.isFinite(val)) retry = Math.min(val, 60_000)
        }
      }
    }

    const text = data.join("\n")
    if (!text) {
      if (id !== undefined) options.onEventID?.(id)
      return
    }

    // Separate the JSON.parse try from the onEvent try. The previous
    // single-try/catch swallowed any error thrown inside onEvent —
    // including real handler bugs — as if it were a parse failure,
    // silently dropping events with no feedback.
    onEvent(parseSSEData(text, { id, retry }) as Parameters<typeof onEvent>[0])
    if (id !== undefined) options.onEventID?.(id)
  }

  try {
    while (!signal.aborted) {
      const next = await waitForAbort(reader.read(), signal).catch((error) => {
        if (signal.aborted) return { done: true as const, value: undefined }
        throw error
      })
      if (next.done) {
        flushTrailing = true
        break
      }
      options.onActivity?.()
      const chunk = decoder.decode(next.value, { stream: true })
      buf += chunk

      // A synchronous handler may abort after the first frame in this chunk.
      // Canceling the reader cannot retract frames already in our buffer.
      while (!signal.aborted) {
        const boundary = SSE_BLOCK_BOUNDARY.exec(buf)
        if (!boundary) break
        const idx = boundary.index
        const gap = boundary[0].length
        checkBufferSize(idx + gap)
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + gap)
        emit(block)
      }
      checkBufferSize(buf.length)
    }
    if (!signal.aborted) flushTrailing = true
  } finally {
    // Flush decoder state once on normal EOF. Aborted or exceptional
    // exits should not emit a trailing partial event.
    try {
      if (flushTrailing && !signal.aborted) {
        buf += decoder.decode()
        if (buf.trim()) emit(buf)
      }
    } finally {
      signal.removeEventListener("abort", cancel)
      // Funnel through the same guarded `cancel()` so an abort-driven
      // exit doesn't double-cancel.
      cancel()
      reader.releaseLock()
    }
  }
}

function checkBufferSize(size: number) {
  if (size <= MAX_SSE_BUFFER_CHARS) return
  log.warn("SSE buffer exceeded limit", { size, max: MAX_SSE_BUFFER_CHARS })
  throw new Error(`SSE buffer exceeded maximum size (${MAX_SSE_BUFFER_CHARS} chars)`)
}
