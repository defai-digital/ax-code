export async function parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: unknown) => void,
) {
  const LIMIT = 64 * 1024 * 1024
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let tail = ""
  let block: string[] = []
  let size = 0
  let overflow = false
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

  const push = (text: string) => {
    if (!text) return
    tail += text
    size += text.length
    if (size > LIMIT) {
      overflow = true
      throw new Error("SSE buffer limit exceeded")
    }

    while (true) {
      const idx = tail.indexOf("\n")
      if (idx === -1) return
      const raw = tail.slice(0, idx)
      tail = tail.slice(idx + 1)
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw
      if (line) {
        block.push(line)
        continue
      }
      emit(block.join("\n"))
      block = []
      size = tail.length
    }
  }

  const finish = () => {
    if (overflow) {
      // Emit whatever complete events were buffered before overflow.
      if (block.length > 0) emit(block.join("\n"))
      tail = ""
      block = []
      size = 0
      return
    }
    push(decoder.decode())
    const line = tail.endsWith("\r") ? tail.slice(0, -1) : tail
    if (line) block.push(line)
    tail = ""
    size = 0
    if (block.length === 0) return
    emit(block.join("\n"))
    block = []
  }

  try {
    while (!signal.aborted) {
      const next = await reader.read()
      if (next.done) break
      push(decoder.decode(next.value, { stream: true }))
    }
  } finally {
    finish()
    signal.removeEventListener("abort", cancel)
    await reader.cancel().catch(() => {})
  }
}
