/** A complete SSE block; absent data fields do not yield a stream item. */
export interface SseBlock {
  data: string[]
  event?: string
  id?: string
  retry?: number
}

/** A frame exceeded the configured character budget; reconnecting would repeat it. */
export class SseFrameLimitError extends Error {
  constructor() {
    super("SSE event exceeds the configured character limit")
    this.name = "SseFrameLimitError"
  }
}

/** Incremental line framing, including CRLF split across transport chunks. */
export class SseParser {
  private skipLF = false
  private fragments: string[] = []
  private pending = ""
  private units = 0
  private block: SseBlock = { data: [] }

  constructor(private readonly maxUnits = 16 * 1024 * 1024) {
    if (!Number.isSafeInteger(maxUnits) || maxUnits < 1) throw new RangeError("Invalid SSE event character limit")
  }

  private append(value: string) {
    this.units += value.length
    if (this.units > this.maxUnits) throw new SseFrameLimitError()
    this.pending += value
    // Bound the fragment count as well as content size for one-byte transports.
    if (this.pending.length >= 4096) {
      this.fragments.push(this.pending)
      this.pending = ""
    }
  }

  private line(): SseBlock | undefined {
    const line = this.fragments.length ? [...this.fragments, this.pending].join("") : this.pending
    this.fragments = []
    this.pending = ""
    if (!line) {
      const result = this.block
      this.block = { data: [] }
      this.units = 0
      return result
    }
    if (line.startsWith(":")) return undefined
    const colon = line.indexOf(":")
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)
    if (field === "data") this.block.data.push(value)
    else if (field === "event") this.block.event = value
    else if (field === "id" && !value.includes("\0")) this.block.id = value
    else if (field === "retry" && /^\d+$/.test(value)) {
      const retry = Number(value)
      if (Number.isSafeInteger(retry)) this.block.retry = retry
    }
    return undefined
  }

  *feed(value: string): Generator<SseBlock> {
    let start = 0
    for (let i = 0; i < value.length; i++) {
      const char = value.charCodeAt(i)
      if (this.skipLF) {
        this.skipLF = false
        if (char === 10) {
          start = i + 1
          continue
        }
      }
      if (char !== 10 && char !== 13) continue
      this.append(value.slice(start, i))
      // Count separators too so millions of short fields cannot evade admission.
      if (++this.units > this.maxUnits) throw new SseFrameLimitError()
      const block = this.line()
      this.skipLF = char === 13
      start = i + 1
      if (block) yield block
    }
    this.append(value.slice(start))
  }
}

/** Retry waits stop promptly on caller abort, including custom sleep functions. */
export async function sleepSse(ms: number, signal: AbortSignal, custom?: (ms: number) => Promise<void>) {
  if (signal.aborted) return
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort!: () => void
  const cancelled = new Promise<void>((resolve) => {
    abort = resolve
    signal.addEventListener("abort", abort, { once: true })
  })
  try {
    const waiting = custom
      ? custom(ms)
      : new Promise<void>((resolve) => {
          timer = setTimeout(resolve, ms)
        })
    await Promise.race([waiting, cancelled])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    signal.removeEventListener("abort", abort)
  }
}
