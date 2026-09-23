import { isMahjongStyle, MAHJONG_COLUMNS, MAHJONG_ROWS } from "./mahjong-view-model"
import { isFujiStyle } from "./fuji-view-model"
import { renderFujiPixels } from "./fuji-pixels"
import { textSceneBackground, textSceneRows, type TextSceneStyle } from "./text-scene-view-model"

// Original stroke glyphs for the scene's ASCII alphabet. No system font or
// browser is required. Coordinates use the reference's 13px font and 1.2 line
// height, with a 0.6em monospace advance. Coverage gives smooth edges at any size.
const GLYPHS: Record<string, number[][]> = {
  "+": [
    [0, 7, 7.8, 7],
    [3.9, 3, 3.9, 11],
  ],
  ":": [
    [3.8, 5, 4, 5],
    [3.8, 10, 4, 10],
  ],
  B: [
    [1, 12, 1, 2, 5, 2, 6.8, 4, 5, 7, 1, 7],
    [5, 7, 6.8, 9, 5, 12, 1, 12],
  ],
  C: [[6.8, 3, 5, 2, 2.5, 2, 1, 4, 1, 10, 2.5, 12, 5, 12, 6.8, 11]],
  F: [
    [1, 12, 1, 2, 6.8, 2],
    [1, 7, 5.5, 7],
  ],
  K: [
    [1, 2, 1, 12],
    [6.8, 2, 1, 7, 6.8, 12],
  ],
  L: [[1, 2, 1, 12, 6.8, 12]],
  O: [[2.5, 2, 5, 2, 6.8, 4, 6.8, 10, 5, 12, 2.5, 12, 1, 10, 1, 4, 2.5, 2]],
  P: [[1, 12, 1, 2, 5, 2, 6.8, 4, 6.8, 5, 5, 7, 1, 7]],
  V: [[0.5, 2, 3.9, 12, 7.3, 2]],
  W: [[0.5, 2, 1.5, 12, 3.9, 7, 6.3, 12, 7.3, 2]],
  Y: [
    [0.5, 2, 3.9, 7, 7.3, 2],
    [3.9, 7, 3.9, 12],
  ],
  "0": [
    [2.5, 2, 5, 2, 6.8, 4, 6.8, 10, 5, 12, 2.5, 12, 1, 10, 1, 4, 2.5, 2],
    [2, 10, 6, 4],
  ],
  "1": [
    [2, 4, 4, 2, 4, 12],
    [1, 12, 7, 12],
  ],
  "2": [[1, 4, 2.5, 2, 5, 2, 6.8, 4, 6, 6, 1, 12, 7, 12]],
  "3": [[1, 2, 6.8, 2, 4, 6, 6.8, 8, 6.8, 10, 5, 12, 1, 12]],
  "4": [[5, 12, 5, 2, 0.5, 9, 7.3, 9]],
  "5": [[6.8, 2, 1, 2, 1, 6, 5, 6, 6.8, 8, 6.8, 10, 5, 12, 1, 12]],
  "6": [[6, 2, 3, 2, 1, 5, 1, 10, 3, 12, 5, 12, 6.8, 10, 6.8, 8, 5, 6, 1, 6]],
  "7": [[1, 2, 7, 2, 3, 12]],
  "8": [
    [3, 2, 5, 2, 6.5, 4, 5, 7, 2.5, 7, 1, 4, 3, 2],
    [2.5, 7, 1, 10, 3, 12, 5, 12, 6.8, 10, 5, 7],
  ],
  "9": [[6.8, 7, 2.5, 7, 1, 5, 1, 4, 2.5, 2, 5, 2, 6.8, 4, 6.8, 10, 5, 12, 2, 12]],
  "~": [[0, 8, 1.5, 6, 3, 6, 5, 8, 6.5, 8, 7.8, 6]],
  M: [[1, 12, 1, 2, 3.9, 7, 6.8, 2, 6.8, 12]],
  I: [
    [1, 2, 6.8, 2],
    [3.9, 2, 3.9, 12],
    [1, 12, 6.8, 12],
  ],
  D: [[1, 12, 1, 2, 4.5, 2, 6.8, 4, 6.8, 10, 4.5, 12, 1, 12]],
  N: [[1, 12, 1, 2, 6.8, 12, 6.8, 2]],
  G: [[6.8, 4, 5, 2, 2.5, 2, 1, 4, 1, 10, 2.5, 12, 5, 12, 6.8, 10, 6.8, 7, 4, 7]],
  H: [
    [1, 2, 1, 12],
    [6.8, 2, 6.8, 12],
    [1, 7, 6.8, 7],
  ],
  T: [
    [0, 2, 7.8, 2],
    [3.9, 2, 3.9, 12],
  ],
  E: [
    [6.8, 2, 1, 2, 1, 12, 6.8, 12],
    [1, 7, 5.5, 7],
  ],
  A: [
    [0.5, 12, 3.9, 2, 7.3, 12],
    [2, 8, 5.8, 8],
  ],
  S: [[6.8, 3, 5, 2, 2.5, 2, 1, 4, 2.5, 6, 5, 7, 6.8, 9, 5, 12, 2.5, 12, 1, 11]],
  U: [[1, 2, 1, 10, 2.5, 12, 5, 12, 6.8, 10, 6.8, 2]],
  _: [[0, 12, 7.8, 12]],
  "-": [[1, 7, 6.8, 7]],
  "=": [
    [0, 5, 7.8, 5],
    [0, 9, 7.8, 9],
  ],
  ".": [[3.8, 11, 4, 11]],
  "'": [[4, 2, 3, 5]],
  '"': [
    [2, 2, 2, 5],
    [5.5, 2, 5.5, 5],
  ],
  "/": [[0, 12, 7.8, 1]],
  "\\": [[0, 1, 7.8, 12]],
  "|": [[3.9, 1, 3.9, 12]],
  "(": [[5.5, 1, 3.5, 3, 2.5, 6.5, 3.5, 10, 5.5, 12]],
  ")": [[2.3, 1, 4.3, 3, 5.3, 6.5, 4.3, 10, 2.3, 12]],
  "[": [[5.8, 1, 2, 1, 2, 12, 5.8, 12]],
  "]": [[2, 1, 5.8, 1, 5.8, 12, 2, 12]],
  J: [
    [2, 2, 7, 2],
    [5.5, 2, 5.5, 9, 4.5, 11, 2.5, 11, 1, 9],
  ],
  R: [
    [1.5, 12, 1.5, 2, 5, 2, 6.5, 3.5, 6.5, 5, 5, 6.5, 1.5, 6.5],
    [4, 6.5, 7, 12],
  ],
  "*": [
    [3.9, 2, 3.9, 10],
    [0.5, 4, 7.3, 8],
    [0.5, 8, 7.3, 4],
  ],
}
// Private ASCII atlas slots for directly drawn tile faces; text fallback uses
// readable suit codes instead. These are never terminal emoji glyphs.
const pip = (x: number, y: number) => [x - 0.7, y, x, y - 0.7, x + 0.7, y, x, y + 0.7, x - 0.7, y]
for (let count = 1; count <= 6; count++) {
  GLYPHS[String.fromCharCode(96 + count)] = Array.from({ length: count }, (_, i) =>
    pip(count === 1 ? 3.9 : 2.2 + (i % 2) * 3.4, count === 1 ? 7 : 3.5 + Math.floor(i / 2) * 3.5),
  )
}
for (let count = 1; count <= 4; count++) {
  GLYPHS[String.fromCharCode(102 + count)] = Array.from({ length: count }, (_, i) => {
    const x = 1.4 + i * 1.6
    return [x, 3, x, 11]
  })
}
GLYPHS.k = [
  [1.5, 5, 6.3, 5, 6.3, 9, 1.5, 9, 1.5, 5],
  [3.9, 2, 3.9, 12],
]
GLYPHS.l = [
  [1.5, 4, 6.3, 4],
  [2, 2, 2, 11, 6.3, 9],
  [1.5, 7, 6.3, 7],
]
GLYPHS.m = [[1.5, 3, 6.3, 3, 6.3, 11, 1.5, 11, 1.5, 3]]
GLYPHS.n = [
  [1.5, 3, 6.3, 3, 6.3, 11, 1.5, 11, 1.5, 3],
  [1.5, 7, 6.3, 7],
  [3.9, 3, 3.9, 11],
]
const ADVANCE = 7.8
const LINE_HEIGHT = 15.6
const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))

// Cache one raster size only, keeping resize and preview memory bounded.
let cachedSize = ""
const masks = new Map<string, Float32Array>()
function glyphMask(char: string, width: number, height: number) {
  const key = `${width}:${height}`
  if (key !== cachedSize) {
    masks.clear()
    cachedSize = key
  }
  const existing = masks.get(char)
  if (existing) return existing
  const mask = new Float32Array(width * height)
  const sx = width / ADVANCE,
    sy = height / LINE_HEIGHT
  const radius = 0.55 * Math.min(sx, sy)
  for (const path of GLYPHS[char] ?? []) {
    for (let segment = 0; segment < path.length - 2; segment += 2) {
      const ax = path[segment]! * sx,
        ay = path[segment + 1]! * sy
      const bx = path[segment + 2]! * sx,
        by = path[segment + 3]! * sy
      const dx = bx - ax,
        dy = by - ay
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const t = Math.max(0, Math.min(1, ((x + 0.5 - ax) * dx + (y + 0.5 - ay) * dy) / (dx * dx + dy * dy)))
          const distance = Math.hypot(x + 0.5 - ax - t * dx, y + 0.5 - ay - t * dy)
          const index = y * width + x
          mask[index] = Math.max(mask[index]!, Math.max(0, Math.min(1, radius + 0.5 - distance)))
        }
      }
    }
  }
  masks.set(char, mask)
  return mask
}

export function renderTextScenePixels(width: number, height: number, style: TextSceneStyle, elapsedMs: number): Buffer {
  // Fuji paints freeform HD frames from the shared scene model; the glyph
  // rasterizer below serves the remaining text scenes.
  if (isFujiStyle(style)) return renderFujiPixels(width, height, style, elapsedMs)
  const pixels = Buffer.alloc(width * height * 3)
  const sceneBackground = rgb(textSceneBackground(style))
  pixels.fill(Buffer.from(sceneBackground))
  // Fit the complete reference composition, retaining its 1:2 cell aspect.
  // Pixel output is independent of terminal columns, font, and line spacing.
  const columns = isMahjongStyle(style) ? MAHJONG_COLUMNS : 70
  const sceneHeight = isMahjongStyle(style) ? MAHJONG_ROWS : 23
  const cellWidth = Math.max(1, Math.floor(Math.min(width / (columns + 4), height / ((sceneHeight + 2) * 2))))
  const cellHeight = cellWidth * 2
  const left = Math.floor((width - columns * cellWidth) / 2)
  const top = Math.floor((height - sceneHeight * cellHeight) / 2)
  const rows = textSceneRows(columns, sceneHeight, style, elapsedMs, true)
  for (let row = 0; row < rows.length; row++) {
    let column = 0
    for (const run of rows[row]!) {
      const foreground = rgb(run.color)
      const runBackground = run.background ? rgb(run.background) : undefined
      for (const char of run.text) {
        const x0 = left + column++ * cellWidth,
          y0 = top + row * cellHeight
        if (char === " " && !run.background) continue
        const mask = glyphMask(char, cellWidth, cellHeight)
        for (let y = 0; y < cellHeight; y++) {
          if (y0 + y < 0 || y0 + y >= height) continue
          const background = runBackground ?? sceneBackground
          for (let x = 0; x < cellWidth; x++) {
            if (x0 + x < 0 || x0 + x >= width) continue
            const alpha = mask[y * cellWidth + x]!
            const index = ((y0 + y) * width + x0 + x) * 3
            for (let c = 0; c < 3; c++)
              pixels[index + c] = Math.round(background[c]! + alpha * (foreground[c]! - background[c]!))
          }
        }
      }
    }
  }
  return pixels
}
