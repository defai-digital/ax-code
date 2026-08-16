/**
 * MiniMax (and some Qwen/vLLM builds) emit thinking as XML-ish tags inside
 * ordinary text deltas instead of native reasoning events. Without a rewrite
 * those tags land in visible assistant text and break title generation.
 */

export type ThinkTagName = "mm:think" | "think" | "thinking"

export type ThinkTagPair = {
  open: string
  close: string
  name: ThinkTagName
}

export const THINK_TAG_PAIRS: readonly ThinkTagPair[] = [
  { open: "<thinking>", close: "</thinking>", name: "thinking" },
  { open: "<mm:think>", close: "</mm:think>", name: "mm:think" },
  { open: "<think>", close: "</think>", name: "think" },
]

export type ThinkTagChunk = {
  type: "text" | "reasoning"
  text: string
  tag?: ThinkTagName
}

function findOpenTag(buffer: string): { index: number; pair: ThinkTagPair } | undefined {
  let best: { index: number; pair: ThinkTagPair } | undefined
  for (const pair of THINK_TAG_PAIRS) {
    const index = buffer.indexOf(pair.open)
    if (index === -1) continue
    if (!best || index < best.index || (index === best.index && pair.open.length > best.pair.open.length)) {
      best = { index, pair }
    }
  }
  return best
}

function longestTagPrefix(buffer: string, candidates: readonly string[]): number {
  let keep = 0
  for (let i = 1; i <= buffer.length; i++) {
    const suffix = buffer.slice(buffer.length - i)
    if (candidates.some((candidate) => candidate.startsWith(suffix))) keep = i
  }
  return keep
}

export type ThinkTagStreamOptions = {
  /**
   * Start the stream already inside a reasoning block closed by `</think>`.
   * Chat templates that prefill `<think>` into the generation prompt (Ornith
   * with `enable_thinking`) emit bare reasoning text first — the opening tag
   * never appears in the stream, so without this the reasoning and the
   * literal close tag leak into visible text.
   */
  assumePrefilledThinkBlock?: boolean
}

export class ThinkTagParser {
  private buffer = ""
  private mode: "text" | "reasoning" = "text"
  private active: ThinkTagPair | undefined

  constructor(options: ThinkTagStreamOptions = {}) {
    if (options.assumePrefilledThinkBlock) {
      this.mode = "reasoning"
      this.active = THINK_TAG_PAIRS.find((pair) => pair.name === "think")
    }
  }

  get inReasoning() {
    return this.mode === "reasoning"
  }

  get activeTag() {
    return this.active?.name
  }

  push(delta: string): ThinkTagChunk[] {
    if (!delta) return []
    this.buffer += delta
    return this.drain(false)
  }

  flush(): ThinkTagChunk[] {
    return this.drain(true)
  }

  private drain(flush: boolean): ThinkTagChunk[] {
    const out: ThinkTagChunk[] = []
    while (this.buffer.length > 0) {
      if (this.mode === "text") {
        const hit = findOpenTag(this.buffer)
        if (!hit) {
          if (!flush) {
            const keep = longestTagPrefix(
              this.buffer,
              THINK_TAG_PAIRS.map((pair) => pair.open),
            )
            const emit = this.buffer.slice(0, this.buffer.length - keep)
            this.buffer = this.buffer.slice(this.buffer.length - keep)
            if (emit) out.push({ type: "text", text: emit })
          } else {
            out.push({ type: "text", text: this.buffer })
            this.buffer = ""
          }
          break
        }
        if (hit.index > 0) out.push({ type: "text", text: this.buffer.slice(0, hit.index) })
        this.buffer = this.buffer.slice(hit.index + hit.pair.open.length)
        this.mode = "reasoning"
        this.active = hit.pair
        continue
      }

      const close = this.active!.close
      const index = this.buffer.indexOf(close)
      if (index === -1) {
        if (!flush) {
          const keep = longestTagPrefix(this.buffer, [close])
          const emit = this.buffer.slice(0, this.buffer.length - keep)
          this.buffer = this.buffer.slice(this.buffer.length - keep)
          if (emit) out.push({ type: "reasoning", text: emit, tag: this.active!.name })
        } else {
          out.push({ type: "reasoning", text: this.buffer, tag: this.active!.name })
          this.buffer = ""
        }
        break
      }
      if (index > 0) out.push({ type: "reasoning", text: this.buffer.slice(0, index), tag: this.active!.name })
      this.buffer = this.buffer.slice(index + close.length)
      this.mode = "text"
      this.active = undefined
    }
    return out
  }
}

const THINK_TAG_BLOCK_RE = /<(?:mm:think|think|thinking)>[\s\S]*?<\/(?:mm:think|think|thinking)>\s*/gi

/** Strip complete think-tag blocks. Incomplete tails are left in place. */
export function stripThinkTags(text: string) {
  return text.replace(THINK_TAG_BLOCK_RE, "")
}

export function wrapThinkTagText(text: string, tag: ThinkTagName = "mm:think") {
  return `<${tag}>${text}</${tag}>`
}

export function attachThinkTagStream<T extends { fullStream: AsyncIterable<unknown> }>(
  output: T,
  options: ThinkTagStreamOptions = {},
): T {
  const parser = new ThinkTagParser(options)
  let textStarted: { id: string; providerMetadata?: unknown } | undefined
  let pendingTextStart: { id: string; providerMetadata?: unknown } | undefined
  let reasoning: { id: string; seq: number } | undefined
  let seq = 0

  const openReasoning = (tag?: ThinkTagName) => {
    if (reasoning) return []
    seq += 1
    reasoning = { id: `think-tag-${seq}`, seq }
    return [{ type: "reasoning-start" as const, id: reasoning.id, providerMetadata: tag ? { thinkTag: tag } : undefined }]
  }

  const closeReasoning = () => {
    if (!reasoning) return []
    const id = reasoning.id
    reasoning = undefined
    return [{ type: "reasoning-end" as const, id }]
  }

  const emitTextStart = () => {
    if (textStarted || !pendingTextStart) return []
    textStarted = pendingTextStart
    pendingTextStart = undefined
    return [{ type: "text-start" as const, id: textStarted.id, providerMetadata: textStarted.providerMetadata }]
  }

  const emitChunks = (chunks: ThinkTagChunk[], textId?: string, providerMetadata?: unknown) => {
    const events: unknown[] = []
    for (const chunk of chunks) {
      if (chunk.type === "reasoning") {
        events.push(...openReasoning(chunk.tag))
        if (chunk.text) {
          events.push({
            type: "reasoning-delta",
            id: reasoning!.id,
            text: chunk.text,
            providerMetadata: chunk.tag ? { thinkTag: chunk.tag } : undefined,
          })
        }
        continue
      }
      events.push(...closeReasoning())
      if (!chunk.text) continue
      events.push(...emitTextStart())
      events.push({
        type: "text-delta",
        id: textStarted?.id ?? textId,
        text: chunk.text,
        providerMetadata,
      })
    }
    return events
  }

  const flushParser = (textId?: string) => {
    const events = emitChunks(parser.flush(), textId)
    events.push(...closeReasoning())
    return events
  }

  const fullStream: AsyncIterable<unknown> = {
    [Symbol.asyncIterator]() {
      const inner = output.fullStream[Symbol.asyncIterator]()
      let queue: unknown[] = []
      return {
        async next() {
          while (queue.length === 0) {
            const iteration = await inner.next()
            if (iteration.done) {
              queue = flushParser(textStarted?.id)
              if (queue.length === 0) return iteration
              break
            }
            const value = iteration.value
            if (!value || typeof value !== "object" || !("type" in value)) {
              queue = [value]
              break
            }
            const event = value as { type?: string; id?: string; text?: string; providerMetadata?: unknown }
            if (event.type === "text-start") {
              pendingTextStart = { id: String(event.id ?? "text"), providerMetadata: event.providerMetadata }
              textStarted = undefined
              continue
            }
            if (event.type === "text-delta") {
              queue = emitChunks(parser.push(event.text ?? ""), event.id, event.providerMetadata)
              if (queue.length === 0) continue
              break
            }
            if (event.type === "text-end") {
              queue = flushParser(event.id)
              if (textStarted) {
                queue.push({ ...event, id: textStarted.id })
              }
              pendingTextStart = undefined
              textStarted = undefined
              if (queue.length === 0) continue
              break
            }
            queue = [...flushParser(textStarted?.id), value]
            break
          }
          return { done: false as const, value: queue.shift() }
        },
        return: (value?: unknown) =>
          inner.return ? inner.return(value) : Promise.resolve({ done: true as const, value }),
        throw: (error?: unknown) => (inner.throw ? inner.throw(error) : Promise.reject(error)),
      }
    },
  }

  return new Proxy(output, {
    get(target, prop, receiver) {
      if (prop === "fullStream") return fullStream
      return Reflect.get(target, prop, receiver)
    },
  })
}
