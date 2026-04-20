export async function parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: unknown) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ""
  let flushTrailing = false
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }

  signal.addEventListener("abort", cancel, { once: true })

  const emit = (block: string) => {
    const data: string[] = []
    let id: string | undefined
    let retry: number | undefined

    for (const line of block.split(/\r?\n/)) {
      if (!line || line.startsWith(":")) continue
      const idx = line.indexOf(":")
      const key = idx === -1 ? line : line.slice(0, idx)
      const raw = idx === -1 ? "" : line.slice(idx + 1).replace(/^ /, "")
      if (key === "data") {
        data.push(raw)
        continue
      }
      if (key === "id") {
        id = raw
        continue
      }
      if (key === "retry") {
        const val = Number(raw)
        // Reject NaN, negative, and Infinity; cap accepted value at 60s.
        // A buggy or malicious server sending `retry: "9".repeat(20)`
        // would otherwise coerce to Infinity, and a downstream
        // setTimeout on an Infinity delay never fires — blocking
        // reconnection forever.
        if (Number.isFinite(val) && val >= 0) retry = Math.min(val, 60_000)
      }
    }

    const text = data.join("\n")
    if (!text) return

    // Separate the JSON.parse try from the onEvent try. The previous
    // single-try/catch swallowed any error thrown inside onEvent —
    // including real handler bugs — as if it were a parse failure,
    // silently dropping events with no feedback.
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      onEvent({
        type: "sse.message",
        properties: {
          data: text,
          id,
          retry,
        },
      })
      return
    }
    onEvent(parsed as Parameters<typeof onEvent>[0])
  }

  try {
    while (!signal.aborted) {
      const next = await reader.read()
      if (next.done) {
        flushTrailing = true
        break
      }
      buf += decoder.decode(next.value, { stream: true })

      while (true) {
        let idx = buf.indexOf("\n\n")
        let gap = 2
        if (idx === -1) {
          idx = buf.indexOf("\r\n\r\n")
          gap = 4
          if (idx === -1) break
        } else if (idx > 0 && buf[idx - 1] === "\r") {
          idx--
          gap = 3
        }
        const block = buf.slice(0, idx)
        buf = buf.slice(idx + gap)
        emit(block)
      }
    }
    if (!signal.aborted) flushTrailing = true
  } finally {
    // Flush decoder state once on normal EOF. Aborted or exceptional
    // exits should not emit a trailing partial event.
    if (flushTrailing && !signal.aborted) {
      buf += decoder.decode()
      if (buf.trim()) emit(buf)
    }
    buf = ""
    signal.removeEventListener("abort", cancel)
    await reader.cancel().catch(() => {})
  }
}
