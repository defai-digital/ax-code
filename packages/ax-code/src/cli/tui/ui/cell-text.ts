import { stringWidth } from "@/bun/node-compat"

const ELLIPSIS = "…"
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/**
 * Fit `text` into `width` terminal cells, ending with a one-cell "…" when it
 * has to be cut. Cuts land on grapheme boundaries, so a wide glyph (CJK,
 * emoji) is dropped whole rather than split into a half cell.
 */
export function truncateCells(text: string, width: number): string {
  const budget = Math.floor(width)
  if (budget <= 0) return ""
  if (stringWidth(text) <= budget) return text
  if (budget === 1) return ELLIPSIS
  let used = 0
  let out = ""
  for (const { segment } of graphemes.segment(text)) {
    const cells = stringWidth(segment)
    if (used + cells > budget - 1) break
    out += segment
    used += cells
  }
  return out.trimEnd() + ELLIPSIS
}
