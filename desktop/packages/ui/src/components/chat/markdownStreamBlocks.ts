import { marked, type Tokens } from "marked"
import remend from "remend"

export type MarkdownStreamBlock = {
  key: string
  raw: string
  src: string
  mode: "full" | "live"
}

/**
 * Incremental lex cache for a streaming message. `stableBlocks` covers the
 * first `stablePrefixLength` characters of `text`; appended text can only
 * change block structure from the last meaningful token onward, so subsequent
 * ticks re-lex just the tail instead of the whole message.
 */
export type LiveMarkdownLexCache = {
  baseKey: string
  text: string
  stablePrefixLength: number
  stableBlocks: MarkdownStreamBlock[]
}

const hasReferenceDefinitions = (text: string): boolean => {
  return /^\[[^\]]+\]:\s+\S+/m.test(text) || /^\[\^[^\]]+\]:\s+/m.test(text)
}

const hasOpenFence = (raw: string): boolean => {
  const match = raw.match(/^[ \t]{0,3}(`{3,}|~{3,})/)
  if (!match) return false
  const marker = match[1]
  if (!marker) return false
  const char = marker[0]
  const size = marker.length
  const last = raw.trimEnd().split("\n").at(-1)?.trim() ?? ""
  return !new RegExp(`^[\\t ]{0,3}${char}{${size},}[\\t ]*$`).test(last)
}

const healMarkdown = (text: string): string => {
  return remend(text, { linkMode: "text-only" })
}

const fnv1a32 = (input: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0
  }
  return hash.toString(16)
}

const buildMarkdownCacheKey = (baseKey: string, raw: string, index: number, mode: "full" | "live"): string => {
  const sample = raw.length > 400 ? `${raw.slice(0, 200)}${raw.slice(-200)}` : raw
  return `${baseKey}:${index}:${mode}:${raw.length}:${fnv1a32(sample)}`
}

export const buildFullMarkdownBlock = (text: string, baseKey: string): MarkdownStreamBlock => ({
  key: buildMarkdownCacheKey(baseKey, text, 0, "full"),
  raw: text,
  src: text,
  mode: "full",
})

const buildWholeLiveBlock = (text: string, baseKey: string): MarkdownStreamBlock => ({
  key: buildMarkdownCacheKey(baseKey, text, 0, "live"),
  raw: text,
  src: healMarkdown(text),
  mode: "live",
})

const emptyCache = (baseKey: string, text: string): LiveMarkdownLexCache => ({
  baseKey,
  text,
  stablePrefixLength: 0,
  stableBlocks: [],
})

/**
 * Split streaming markdown into renderable blocks: every block except the last
 * meaningful one is final ("full"), the trailing block is "live" and re-renders
 * as it grows. When `cache` matches an append-only prefix of `text`, only the
 * tail after the cached stable prefix is re-lexed and re-healed — the output is
 * identical to lexing from scratch, but per-tick cost stays proportional to the
 * tail instead of the whole message.
 */
export const buildLiveMarkdownBlocks = (
  text: string,
  baseKey: string,
  cache?: LiveMarkdownLexCache | null,
): { blocks: MarkdownStreamBlock[]; cache: LiveMarkdownLexCache } => {
  // Reference definitions can restyle earlier blocks, so fall back to one live
  // block over the whole text.
  if (hasReferenceDefinitions(text)) {
    return { blocks: [buildWholeLiveBlock(text, baseKey)], cache: emptyCache(baseKey, text) }
  }

  const canReusePrefix =
    cache != null &&
    cache.baseKey === baseKey &&
    cache.stablePrefixLength > 0 &&
    text.length >= cache.text.length &&
    text.startsWith(cache.text)
  const stableBlocks = canReusePrefix ? cache.stableBlocks : []
  const stablePrefixLength = canReusePrefix ? cache.stablePrefixLength : 0

  const tokens = marked.lexer(text.slice(stablePrefixLength))

  let lastMeaningfulIndex = -1
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index]?.type !== "space") {
      lastMeaningfulIndex = index
    }
  }

  const blocks = stableBlocks.slice()
  let blockIndex = stableBlocks.length
  let nextStablePrefixLength = stablePrefixLength
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as Tokens.Generic
    const raw = token.raw ?? ""
    if (token.type !== "space") {
      const mode: "full" | "live" = index === lastMeaningfulIndex ? "live" : "full"
      const src = mode === "live" && token.type === "code" && hasOpenFence(raw) ? raw : healMarkdown(raw)
      blocks.push({
        key: buildMarkdownCacheKey(baseKey, raw, blockIndex, mode),
        raw,
        src,
        mode,
      })
      blockIndex += 1
    }
    if (index < lastMeaningfulIndex) {
      nextStablePrefixLength += raw.length
    }
  }

  if (blocks.length === 0) {
    return { blocks: [buildWholeLiveBlock(text, baseKey)], cache: emptyCache(baseKey, text) }
  }

  const lastBlock = blocks[blocks.length - 1]
  return {
    blocks,
    cache: {
      baseKey,
      text,
      stablePrefixLength: nextStablePrefixLength,
      stableBlocks: lastBlock?.mode === "live" ? blocks.slice(0, -1) : blocks,
    },
  }
}
