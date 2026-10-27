// Unified token estimator (ADR-139 D5). Preflight admission, context status,
// memory/stats, and the provider token ledger all read this one module
// instead of re-deriving their own chars/4 heuristics. No tokenizer and no
// chat-template rendering: every derived figure is an estimate whose
// provenance ("estimated") is applied by callers via provider/usage.ts.

import type { ModelMessage } from "ai"
import { Token } from "@/util/token"
import { isRecord } from "@/util/record"

export namespace TokenEstimate {
  // Fixed per-item media constants (ADR-139 spec Module 1). Video/audio are
  // not estimated: mediaTokens returns 0 for them and callers surface the
  // "unestimated" flag from hasUnestimatedMedia.
  export const IMAGE_TOKENS = 1_100
  export const PDF_TOKENS = 1_800

  const MESSAGE_OVERHEAD_TOKENS = 4
  const TOOL_SCHEMA_OVERHEAD_TOKENS = 8

  // Same math as util/token.ts (max(0, round(chars/4))); that module stays
  // the single low-level implementation so util never imports provider code.
  export function textTokens(input: string) {
    return Token.estimate(input)
  }

  type ContentPart = Record<string, unknown>

  function mediaTypeOf(part: ContentPart): string | undefined {
    for (const key of ["mediaType", "mime", "mimeType"]) {
      const value = part[key]
      if (typeof value === "string" && value) return value
    }
    return undefined
  }

  /**
   * Fixed media estimate for one message content part. Returns 0 with
   * `unestimated: true` for video/audio (and for unrecognized media) — those
   * occupy provider window we cannot price locally.
   */
  export function mediaTokens(part: unknown): { tokens: number; unestimated: boolean } {
    if (!isRecord(part)) return { tokens: 0, unestimated: false }
    const type = typeof part.type === "string" ? part.type : ""
    const mediaType = mediaTypeOf(part)?.toLowerCase() ?? ""
    if (type === "image" || mediaType.startsWith("image/")) return { tokens: IMAGE_TOKENS, unestimated: false }
    if (mediaType === "application/pdf" || type === "pdf") return { tokens: PDF_TOKENS, unestimated: false }
    if (type === "video" || type === "audio" || mediaType.startsWith("video/") || mediaType.startsWith("audio/")) {
      return { tokens: 0, unestimated: true }
    }
    return { tokens: 0, unestimated: false }
  }

  /**
   * Media/text entries nested one level down in a tool-result `content`
   * output. Tool results carry attachments this way (session/message-v2-impl.ts
   * converts each one to `{type:"media", mediaType, data}`), so serializing the
   * wrapper would price a 1 MB screenshot as ~250k text tokens instead of one
   * image. Returns undefined for every other part shape so the whole-array
   * serialization fast path is untouched.
   */
  function nestedContentEntries(part: unknown): ContentPart[] | undefined {
    if (!isRecord(part) || part.type !== "tool-result") return undefined
    const output = part.output
    if (!isRecord(output) || output.type !== "content") return undefined
    const value = output.value
    return Array.isArray(value) ? value.filter(isRecord) : undefined
  }

  /** Entries a part contributes to the estimate: nested tool-result content, or the part itself. */
  function mediaEntries(part: unknown): ContentPart[] {
    const nested = nestedContentEntries(part)
    if (nested) return nested
    return isRecord(part) ? [part] : []
  }

  function isMediaEntry(entry: ContentPart): boolean {
    const media = mediaTokens(entry)
    return media.tokens > 0 || media.unestimated
  }

  function isMediaPart(part: unknown): boolean {
    return mediaEntries(part).some(isMediaEntry)
  }

  // Per-message estimate cache. Serializing a message's content dominates the
  // estimate cost, and this runs against the full history on every prompt
  // step. Message objects are stable across steps (toModelMessages caches
  // per-message conversions and treats results as immutable), so the object
  // itself is a safe cache key; replaced objects simply miss and recompute.
  const estimateCache = new WeakMap<ModelMessage, number>()

  /**
   * Estimated tokens for one message: string content as-is, parts serialized
   * to JSON, plus the fixed per-message framing overhead. Media parts — and
   * media entries nested in tool-result content — are priced at the fixed
   * media constants instead of their serialized form.
   */
  export function messageTokens(message: ModelMessage): number {
    if (typeof message.content === "string") {
      return Token.estimate(message.content) + MESSAGE_OVERHEAD_TOKENS
    }
    const cached = estimateCache.get(message)
    if (cached !== undefined) return cached
    const parts = Array.isArray(message.content) ? message.content : []
    const hasMedia = parts.some(isMediaPart)
    let estimate: number
    if (!hasMedia) {
      // Identical math to the previous heuristic: serialize the whole content
      // array once, then add the per-message overhead.
      estimate = Token.estimate(JSON.stringify(message.content))
    } else {
      estimate = 0
      for (const part of parts) {
        for (const entry of mediaEntries(part)) {
          const media = mediaTokens(entry)
          if (media.unestimated) continue
          if (media.tokens > 0) {
            estimate += media.tokens
            continue
          }
          estimate += textTokens(JSON.stringify(entry))
        }
      }
    }
    const total = estimate + MESSAGE_OVERHEAD_TOKENS
    estimateCache.set(message, total)
    return total
  }

  export function toolSchemaTokens(tools: Iterable<{ id: string; description?: string; inputSchema: unknown }>) {
    let total = 0
    for (const item of tools) {
      total += Token.estimate(
        JSON.stringify({
          name: item.id,
          description: item.description ?? "",
          parameters: item.inputSchema,
        }),
      )
      total += TOOL_SCHEMA_OVERHEAD_TOKENS
    }
    return total
  }

  /**
   * The single request-estimate entry point (preflight, context status,
   * ledger). `tools` is optional so tool-less call sites keep the previous
   * system+messages-only math.
   */
  export function requestTokens(input: {
    system: string[]
    messages: ModelMessage[]
    tools?: Iterable<{ id: string; description?: string; inputSchema: unknown }>
  }) {
    let total = 0
    for (const item of input.system) {
      total += Token.estimate(item) + MESSAGE_OVERHEAD_TOKENS
    }
    for (const message of input.messages) {
      total += messageTokens(message)
    }
    if (input.tools) {
      total += toolSchemaTokens(input.tools)
    }
    return total
  }

  /** Sum of the fixed media constants across all media parts in the messages, including tool-result content. */
  export function mediaTokenTotal(messages: ModelMessage[]) {
    let total = 0
    for (const message of messages) {
      if (typeof message.content === "string") continue
      const parts = Array.isArray(message.content) ? message.content : []
      for (const part of parts) {
        for (const entry of mediaEntries(part)) {
          const media = mediaTokens(entry)
          if (!media.unestimated) total += media.tokens
        }
      }
    }
    return total
  }

  /** True when any message carries video/audio media the estimator cannot price. */
  export function hasUnestimatedMedia(messages: ModelMessage[]) {
    for (const message of messages) {
      if (typeof message.content === "string") continue
      const parts = Array.isArray(message.content) ? message.content : []
      for (const part of parts) {
        if (mediaEntries(part).some((entry) => mediaTokens(entry).unestimated)) return true
      }
    }
    return false
  }
}
