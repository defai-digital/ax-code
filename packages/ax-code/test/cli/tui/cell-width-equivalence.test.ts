import { describe, expect, test } from "vitest"
import stripAnsi from "strip-ansi"
import { stringWidth } from "../../../src/bun/node-compat"
import { truncateToCellWidth, wrapPreview } from "../../../src/cli/tui/routes/session/last-input-view-model"

// Reference implementations: the pre-optimization bodies, kept verbatim so the
// fast paths (ANSI presence check, single overflow walk, constant ellipsis
// width) can be proven byte-identical instead of merely width-identical.

function charWidthReference(cp: number): number {
  if (cp === 0) return 0
  if (cp < 32 || (cp >= 0x7f && cp < 0xa0)) return 0
  if (
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x200b && cp <= 0x200f) ||
    cp === 0xfeff ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff)
  )
    return 0
  return stringWidth(String.fromCodePoint(cp))
}

function stringWidthReference(input: string) {
  let width = 0
  for (const ch of stripAnsi(input)) width += charWidthReference(ch.codePointAt(0) ?? 0)
  return width
}

const ELLIPSIS = "..."
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

function fitWidthReference(text: string, width: number) {
  if (width <= 0) return ""
  if (stringWidthReference(text) <= width) return text
  let out = ""
  let used = 0
  for (const { segment: ch } of graphemes.segment(text)) {
    const next = stringWidthReference(ch)
    if (used + next > width) break
    out += ch
    used += next
  }
  return out
}

function truncateReference(text: string, width: number) {
  if (width <= 0) return ""
  if (stringWidthReference(text) <= width) return text
  const ellipsisWidth = stringWidthReference(ELLIPSIS)
  const budget = Math.max(0, width - ellipsisWidth)
  return fitWidthReference(text, budget).trimEnd() + fitWidthReference(ELLIPSIS, width)
}

function wrapPreviewReference(text: string, firstLineWidth: number, nextLineWidth: number, maxLines: 1 | 2) {
  const lines: string[] = []
  let remaining = text
  for (let index = 0; index < maxLines; index++) {
    const width = index === 0 ? firstLineWidth : nextLineWidth
    const last = index === maxLines - 1
    if (width <= 0) break
    if (stringWidthReference(remaining) <= width) {
      if (remaining) lines.push(remaining)
      break
    }
    if (last) {
      lines.push(truncateReference(remaining, width))
      break
    }
    const fitted = fitWidthReference(remaining, width)
    if (!fitted) break
    const next = remaining.slice(fitted.length).charAt(0)
    const midWord = next !== "" && next !== " "
    const breakAt = midWord ? fitted.lastIndexOf(" ") : -1
    const chunk = breakAt > 0 ? fitted.slice(0, breakAt) : fitted
    lines.push(chunk)
    remaining = remaining.slice(chunk.length).trimStart()
    if (!remaining) break
  }
  return lines
}

const PIECES = [
  "hello world  ",
  "你好世界",
  "한글",
  "é",
  "👨‍👩‍👧",
  "🙂",
  "　",
  "\x1b[31m",
  "\x1b[0m",
  "\x1b[38;2;1;2;3m",
  "\u001b",
  "\u009b31m",
  "\x1b]8;;https://example.test\x07link\x1b]8;;\x07",
  "   ",
  "a b c",
  "\t",
  "café",
]

function rng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomString(next: () => number) {
  let out = ""
  const count = 1 + Math.floor(next() * 12)
  for (let index = 0; index < count; index++) out += PIECES[Math.floor(next() * PIECES.length)]
  return out
}

const WIDTHS = [0, 1, 2, 3, 4, 5, 8, 16, 80]

describe("cell width helpers stay byte-identical to the reference implementation", () => {
  test("named edge cases", () => {
    const cases = ["", "...", "你好", "hello  ", "\x1b[31mhello\x1b[0m", "é", "👨‍👩‍👧", "\x1b", "\u009b", "a‍b"]
    for (const text of cases) {
      expect(stringWidth(text), JSON.stringify(text)).toBe(stringWidthReference(text))
      for (const width of [0, 1, 2, 3, 4]) {
        expect(truncateToCellWidth(text, width), JSON.stringify({ text, width })).toBe(truncateReference(text, width))
      }
    }
  })

  test("randomized strings with ANSI, CJK, emoji, and combining marks", () => {
    const next = rng(0x9e3779b9)
    for (let round = 0; round < 400; round++) {
      const text = randomString(next)
      expect(stringWidth(text), JSON.stringify(text)).toBe(stringWidthReference(text))
      for (const width of WIDTHS) {
        expect(truncateToCellWidth(text, width), JSON.stringify({ text, width })).toBe(truncateReference(text, width))
        for (const nextWidth of [0, 3, 8, 40]) {
          for (const maxLines of [1, 2] as const) {
            expect(wrapPreview(text, width, nextWidth, maxLines), JSON.stringify({ text, width, nextWidth })).toEqual(
              wrapPreviewReference(text, width, nextWidth, maxLines),
            )
          }
        }
      }
    }
  })
})
