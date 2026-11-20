import type { TextChunk } from "../core/text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

const URL_SCOPES = ["markup.link.url", "string.special.url"]

function isConceal(group: string, meta?: { conceal?: unknown }): boolean {
  return group === "conceal" || group.startsWith("conceal.") || meta?.conceal !== undefined
}

export function detectLinks(
  chunks: TextChunk[],
  context: { content: string; highlights: SimpleHighlight[] },
): TextChunk[] {
  const content = context.content
  const highlights = context.highlights

  const ranges: Array<{ start: number; end: number; url: string }> = []

  for (let i = 0; i < highlights.length; i++) {
    const [start, end, group] = highlights[i]
    if (!URL_SCOPES.includes(group)) continue

    const url = content.slice(start, end)
    ranges.push({ start, end, url })

    for (let j = i - 1; j >= 0; j--) {
      const [labelStart, labelEnd, prev, meta] = highlights[j]
      if (prev === "markup.link.label") {
        // Only pair a label that sits immediately before the URL (just link syntax
        // between them), so a preceding link's label is not stolen across other text.
        if (labelEnd <= start && /^[\s\](:]*$/u.test(content.slice(labelEnd, start))) {
          ranges.push({ start: labelStart, end: labelEnd, url })
        }
        break
      }
      // Conceal captures (e.g. the "]" of an inline link) sit between label and URL.
      if (!prev.startsWith("markup.link") && !isConceal(prev, meta)) break
    }
  }

  if (ranges.length === 0) return chunks

  const assignLink = (chunk: TextChunk, start: number, end: number): void => {
    for (const range of ranges) {
      if (start < range.end && end > range.start) {
        chunk.link = { url: range.url }
        break
      }
    }
  }

  // Chunks from treeSitterToTextChunks carry their source span, which stays correct
  // even when conceal replaces text (e.g. "]" -> " "). For chunks without offsets,
  // locate literal text in order so later positions stay aligned.
  let contentPos = 0
  for (const chunk of chunks) {
    if (chunk.text.length === 0) continue

    if (chunk.contentStart !== undefined && chunk.contentEnd !== undefined) {
      assignLink(chunk, chunk.contentStart, chunk.contentEnd)
      contentPos = chunk.contentEnd
      continue
    }

    const idx = content.indexOf(chunk.text, contentPos)
    if (idx < 0) continue
    assignLink(chunk, idx, idx + chunk.text.length)
    contentPos = idx + chunk.text.length
  }

  return chunks
}