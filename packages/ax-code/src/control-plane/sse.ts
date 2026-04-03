export async function parseSSE(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  onEvent: (event: unknown) => void,
) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buf = ""

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
        if (!Number.isNaN(val)) retry = val
      }
    }

    const text = data.join("\n")
    if (!text) return

    try {
      onEvent(JSON.parse(text))
      return
    } catch {}

    onEvent({
      type: "sse.message",
      properties: {
        data: text,
        id,
        retry,
      },
    })
  }

  while (!signal.aborted) {
    const next = await reader.read()
    if (next.done) break
    buf += decoder.decode(next.value, { stream: true })

    while (true) {
      const idx = buf.search(/\r?\n\r?\n/)
      if (idx === -1) break
      const block = buf.slice(0, idx)
      const gap = buf.slice(idx).match(/^\r?\n\r?\n/)?.[0].length ?? 2
      buf = buf.slice(idx + gap)
      emit(block)
    }
  }

  buf += decoder.decode()
  if (buf.trim()) emit(buf)
  await reader.cancel().catch(() => {})
}
