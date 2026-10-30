import type { TextChunk } from "../core/text-buffer.js"
import type { SimpleHighlight } from "./tree-sitter/types.js"

const URL_SCOPES = ["markup.link.url", "string.special.url"]

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
      const [labelStart, labelEnd, prev] = highlights[j]
      if (prev === "markup.link.label") {
        ranges.push({ start: labelStart, end: labelEnd, url })
        break
      }
      if (!prev.startsWith("markup.link")) break
    }
  }

  if (ranges.length === 0) return chunks

  // Use content.indexOf to find each chunk's position in the original content.
  // Empty concealed chunks are skipped; other chunks, including single-char
  // text, are located in order so later positions stay aligned.
  let contentPos = 0
  for (const chunk of chunks) {
    if (chunk.text.length === 0) continue

    const idx = content.indexOf(chunk.text, contentPos)
    if (idx < 0) continue

    for (const range of ranges) {
      if (idx < range.end && idx + chunk.text.length > range.start) {
        chunk.link = { url: range.url }
        break
      }
    }

    contentPos = idx + chunk.text.length
  }

  return chunks
}
