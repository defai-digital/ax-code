// Original stroke glyphs for the scenes' ASCII alphabet. No system font or
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
const ADVANCE = 7.8
const LINE_HEIGHT = 15.6

// Cache one raster size only, keeping resize and preview memory bounded.
let cachedSize = ""
const masks = new Map<string, Float32Array>()
export function glyphMask(char: string, width: number, height: number) {
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
