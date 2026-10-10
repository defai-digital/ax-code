import { artHash, artLine, blendPixel, glow, softDisk, vignette } from "./scene-art-kit"
import { createHdCanvas, hdDarken, hdHex, hdMix, type RGB } from "./scene-hd"
import {
  MAHJONG_COLORS,
  MAHJONG_COLUMNS,
  MAHJONG_DICE,
  MAHJONG_ENDING_LAYOUT,
  MAHJONG_INNER,
  MAHJONG_MATCH_LAYOUT,
  MAHJONG_PLATE,
  MAHJONG_ROWS,
  MAHJONG_SCORES,
  MAHJONG_TABLE,
  MAHJONG_WALL_BAR_LEN,
  MAHJONG_WALL_BAR_X,
  MAHJONG_WIN_BURST_MS,
  MAHJONG_WIN_HAND,
  mahjongCenterX,
  mahjongDealerMarker,
  mahjongEndingBlink,
  mahjongFeltRgb,
  mahjongLatestMarker,
  mahjongMatch,
  mahjongPondSlot,
  mahjongRank,
  mahjongRankColor,
  mahjongRankedLine,
  mahjongSeatLabel,
  mahjongStep,
  mahjongStepProgress,
  mahjongTileFace,
  mahjongWallFill,
  mahjongWinFlip,
  type MahjongStyle,
} from "./mahjong-view-model"
import { blitGlyphText } from "./text-scene-glyphs"
import { clamp01 } from "./atmos-paint"

/** Ending confetti loop and match loop share one 4800ms cycle. */
const MAHJONG_CYCLE_MS = 4800

const easeOut = (t: number) => 1 - (1 - clamp01(t)) ** 3
const white: RGB = [255, 255, 255]

/** Stroke glyphs on a unit square: numerals, winds, dragons, and the wan mark. */
type Strokes = readonly (readonly number[])[]
const NUMERALS: readonly Strokes[] = [
  [[0.1, 0.5, 0.9, 0.5]],
  [
    [0.25, 0.3, 0.75, 0.3],
    [0.1, 0.72, 0.9, 0.72],
  ],
  [
    [0.3, 0.18, 0.7, 0.18],
    [0.2, 0.5, 0.8, 0.5],
    [0.08, 0.82, 0.92, 0.82],
  ],
  [
    [0.12, 0.15, 0.88, 0.15, 0.88, 0.85, 0.12, 0.85, 0.12, 0.15],
    [0.38, 0.15, 0.38, 0.55],
    [0.62, 0.15, 0.62, 0.55],
    [0.38, 0.55, 0.62, 0.55],
  ],
  [
    [0.2, 0.12, 0.8, 0.12],
    [0.4, 0.12, 0.4, 0.5],
    [0.2, 0.5, 0.78, 0.5, 0.78, 0.85],
    [0.08, 0.85, 0.92, 0.85],
  ],
  [
    [0.5, 0.08, 0.5, 0.25],
    [0.12, 0.38, 0.88, 0.38],
    [0.45, 0.38, 0.2, 0.9],
    [0.55, 0.38, 0.82, 0.9],
  ],
  [
    [0.1, 0.4, 0.9, 0.4],
    [0.55, 0.1, 0.55, 0.78, 0.85, 0.9],
  ],
  [
    [0.42, 0.2, 0.2, 0.88],
    [0.58, 0.2, 0.82, 0.88],
  ],
  [
    [0.12, 0.32, 0.8, 0.32, 0.8, 0.85, 0.62, 0.9],
    [0.45, 0.08, 0.32, 0.9],
  ],
]
const WAN: Strokes = [
  [0.12, 0.1, 0.88, 0.1],
  [0.5, 0.1, 0.5, 0.34],
  [0.1, 0.34, 0.9, 0.34],
  [0.2, 0.5, 0.8, 0.5, 0.8, 0.9, 0.2, 0.9, 0.2, 0.5],
  [0.5, 0.5, 0.5, 0.9],
  [0.2, 0.7, 0.8, 0.7],
]
const WINDS: readonly Strokes[] = [
  [
    [0.12, 0.18, 0.88, 0.18],
    [0.5, 0.06, 0.5, 0.72],
    [0.22, 0.44, 0.78, 0.44],
    [0.5, 0.7, 0.2, 0.92],
    [0.5, 0.7, 0.8, 0.92],
    [0.22, 0.3, 0.22, 0.62],
    [0.78, 0.3, 0.78, 0.62],
  ],
  [
    [0.5, 0.06, 0.5, 0.22],
    [0.1, 0.22, 0.9, 0.22],
    [0.2, 0.4, 0.8, 0.4, 0.8, 0.92, 0.2, 0.92, 0.2, 0.4],
    [0.5, 0.4, 0.5, 0.92],
    [0.2, 0.66, 0.8, 0.66],
  ],
  [
    [0.08, 0.16, 0.92, 0.16],
    [0.3, 0.16, 0.3, 0.5],
    [0.7, 0.16, 0.7, 0.5],
    [0.2, 0.5, 0.8, 0.5, 0.8, 0.92, 0.2, 0.92, 0.2, 0.5],
    [0.5, 0.5, 0.5, 0.92],
  ],
  [
    [0.3, 0.08, 0.3, 0.92],
    [0.08, 0.4, 0.3, 0.4],
    [0.3, 0.58, 0.1, 0.88],
    [0.68, 0.08, 0.68, 0.92],
    [0.68, 0.34, 0.92, 0.12],
    [0.68, 0.58, 0.92, 0.88],
  ],
]
const FA: Strokes = [
  [0.5, 0.06, 0.5, 0.3],
  [0.12, 0.3, 0.88, 0.3],
  [0.3, 0.3, 0.14, 0.92],
  [0.7, 0.3, 0.86, 0.92],
  [0.28, 0.58, 0.72, 0.58],
  [0.4, 0.58, 0.4, 0.92],
]

/** Dot layouts in [-1, 1]; colors cycle through the classic blue, green, and red. */
const DOTS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0, 0, 2]],
  [
    [0, -0.55, 1],
    [0, 0.55, 0],
  ],
  [
    [-0.55, -0.65, 0],
    [0, 0, 2],
    [0.55, 0.65, 1],
  ],
  [
    [-0.5, -0.5, 0],
    [0.5, -0.5, 1],
    [-0.5, 0.5, 1],
    [0.5, 0.5, 0],
  ],
  [
    [-0.5, -0.5, 0],
    [0.5, -0.5, 1],
    [0, 0, 2],
    [-0.5, 0.5, 1],
    [0.5, 0.5, 0],
  ],
  [
    [-0.5, -0.7, 1],
    [0.5, -0.7, 1],
    [-0.5, 0.05, 2],
    [0.5, 0.05, 2],
    [-0.5, 0.75, 2],
    [0.5, 0.75, 2],
  ],
  [
    [-0.6, -0.85, 1],
    [0, -0.65, 1],
    [0.6, -0.45, 1],
    [-0.5, 0.1, 2],
    [0.5, 0.1, 2],
    [-0.5, 0.75, 2],
    [0.5, 0.75, 2],
  ],
  [
    [-0.5, -0.9, 0],
    [0.5, -0.9, 0],
    [-0.5, -0.3, 0],
    [0.5, -0.3, 0],
    [-0.5, 0.3, 0],
    [0.5, 0.3, 0],
    [-0.5, 0.9, 0],
    [0.5, 0.9, 0],
  ],
  [
    [-0.6, -0.7, 1],
    [0, -0.7, 1],
    [0.6, -0.7, 1],
    [-0.6, 0, 2],
    [0, 0, 2],
    [0.6, 0, 2],
    [-0.6, 0.7, 0],
    [0, 0.7, 0],
    [0.6, 0.7, 0],
  ],
]

/** Bamboo layouts: stick center in [-1, 1], relative length, and red flag. */
const STICKS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [],
  [
    [0, -0.5, 0.78, 0],
    [0, 0.5, 0.78, 0],
  ],
  [
    [0, -0.5, 0.78, 0],
    [-0.5, 0.5, 0.78, 0],
    [0.5, 0.5, 0.78, 0],
  ],
  [
    [-0.5, -0.5, 0.78, 0],
    [0.5, -0.5, 0.78, 0],
    [-0.5, 0.5, 0.78, 0],
    [0.5, 0.5, 0.78, 0],
  ],
  [
    [-0.5, -0.5, 0.78, 0],
    [0.5, -0.5, 0.78, 0],
    [0, 0, 0.78, 1],
    [-0.5, 0.5, 0.78, 0],
    [0.5, 0.5, 0.78, 0],
  ],
  [
    [-0.6, -0.5, 0.78, 0],
    [0, -0.5, 0.78, 0],
    [0.6, -0.5, 0.78, 0],
    [-0.6, 0.5, 0.78, 0],
    [0, 0.5, 0.78, 0],
    [0.6, 0.5, 0.78, 0],
  ],
  [
    [0, -0.78, 0.5, 1],
    [-0.6, -0.02, 0.62, 0],
    [0, -0.02, 0.62, 0],
    [0.6, -0.02, 0.62, 0],
    [-0.6, 0.7, 0.62, 0],
    [0, 0.7, 0.62, 0],
    [0.6, 0.7, 0.62, 0],
  ],
  [
    [-0.78, -0.5, 0.78, 0],
    [-0.26, -0.5, 0.78, 0],
    [0.26, -0.5, 0.78, 0],
    [0.78, -0.5, 0.78, 0],
    [-0.78, 0.5, 0.78, 0],
    [-0.26, 0.5, 0.78, 0],
    [0.26, 0.5, 0.78, 0],
    [0.78, 0.5, 0.78, 0],
  ],
  [
    [-0.6, -0.72, 0.56, 0],
    [0, -0.72, 0.56, 1],
    [0.6, -0.72, 0.56, 0],
    [-0.6, 0, 0.56, 0],
    [0, 0, 0.56, 1],
    [0.6, 0, 0.56, 0],
    [-0.6, 0.72, 0.56, 0],
    [0, 0.72, 0.56, 1],
    [0.6, 0.72, 0.56, 0],
  ],
]

/**
 * Freeform HD renderer. A woven felt table under a warm lamp with a jade rim
 * and gold inlay. Tiles are large and solid: an ivory face over a thick jade
 * body with carved circles, bamboo, characters, winds, and dragons. The match
 * shows four hands, a face-up discard pond per seat, a wall ring that shrinks
 * as tiles are drawn, a dealer wind chip, and dice; every turn animates the
 * draw from the wall and the discard flying into the pond. The ending flips a
 * complete winning hand face up, bursts into gold light, banners the score,
 * and showers coins and confetti. Layout, palette, match phase, and flip phase
 * come from the shared view model, so the HD frame and the text fallback show
 * the same scene for the same millisecond. Pure and deterministic: everything
 * derives from `elapsedMs`.
 */
export function renderMahjongPixels(width: number, height: number, style: MahjongStyle, elapsedMs: number): Buffer {
  const hd = createHdCanvas(width, height, MAHJONG_COLUMNS, MAHJONG_ROWS)
  if (hd.w === 0 || hd.h === 0) return hd.pixels
  const { w, h, cw, ch, X, Y } = hd
  const c = MAHJONG_COLORS
  const elapsed = Math.max(0, elapsedMs)
  const u = Math.min(cw, ch / 2)
  const cycleMs = elapsed % MAHJONG_CYCLE_MS
  const cycle = cycleMs / MAHJONG_CYCLE_MS
  const ink = hdHex(c.ink)
  const accent = hdHex(c.accent)
  const info = hdHex(c.info)
  const good = hdHex(c.good)
  const frame = hdHex(c.frame)
  const frameDim = hdHex(c.frameDim)
  const ivory = hdHex(c.tileFace)
  const jade = hdHex(c.tileBack)
  const jadeInk = hdHex(c.tileBackInk)
  const jadeEdge = hdHex(c.tileEdge)
  const gold: RGB = [251, 191, 36]
  const goldLight: RGB = [255, 233, 150]
  const goldDeep: RGB = [160, 104, 10]
  const red: RGB = [196, 44, 44]
  const navy: RGB = [28, 44, 104]

  // Labels blend onto the felt without punching holes in the gradient.
  const blit = (sceneX: number, sceneY: number, text: string, color: RGB) => {
    const cellW = Math.max(1, Math.round(cw))
    const cellH = Math.max(1, Math.round(ch))
    blitGlyphText(hd.pixels, w, h, Math.round(sceneX * cw), Math.round(sceneY * ch), cellW, cellH, text, color)
  }

  // Felt: vertical gradient, woven grain, a warm lamp pool, and a soft vignette.
  hd.sky((t) => mahjongFeltRgb(t))
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const weave = ((x >> 1) + (y >> 1)) % 2 === 0 ? 1.03 : 0.97
      const k = weave + (artHash(x, y) - 0.5) * 0.05
      const i = (y * w + x) * 3
      hd.pixels[i] = Math.min(255, Math.round(hd.pixels[i]! * k))
      hd.pixels[i + 1] = Math.min(255, Math.round(hd.pixels[i + 1]! * k))
      hd.pixels[i + 2] = Math.min(255, Math.round(hd.pixels[i + 2]! * k))
    }
  }
  const lampX = w / 2
  const lampY = Y(style === "mahjong-ending" ? 7 : 11.5)
  const lampBreath = 0.5 + 0.5 * Math.sin(cycle * Math.PI * 2)
  glow(hd, lampX, lampY, Math.max(w, h * 2) * 0.62, [120, 230, 170], 0.17)
  glow(hd, lampX, lampY, Math.max(w, h * 2) * 0.34, [255, 236, 170], 0.07 + lampBreath * 0.03)
  glow(hd, lampX, lampY, Math.max(w, h * 2) * 0.14, [255, 246, 214], 0.05 + lampBreath * 0.03)
  vignette(hd, 0.35)

  // Rounded rectangle with a per-pixel shader and an anti-aliased edge.
  const roundRect = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    radius: number,
    shade: (px: number, py: number, u: number, v: number) => RGB,
    alpha = 1,
  ) => {
    const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
    const xa = Math.max(0, Math.floor(x0))
    const xb = Math.min(w - 1, Math.ceil(x1))
    const ya = Math.max(0, Math.floor(y0))
    const yb = Math.min(h - 1, Math.ceil(y1))
    for (let y = ya; y <= yb; y++) {
      for (let x = xa; x <= xb; x++) {
        const px = x + 0.5
        const py = y + 0.5
        const qx = Math.max(x0 + r - px, 0, px - (x1 - r))
        const qy = Math.max(y0 + r - py, 0, py - (y1 - r))
        const d = Math.hypot(qx, qy) - r
        const cover = Math.max(0, Math.min(1, 0.5 - d))
        if (px < x0 - 0.5 || px > x1 + 0.5 || py < y0 - 0.5 || py > y1 + 0.5 || cover <= 0) continue
        blendPixel(hd, x, y, shade(px, py, (px - x0) / (x1 - x0 || 1), (py - y0) / (y1 - y0 || 1)), cover * alpha)
      }
    }
  }
  const flat = (col: RGB) => () => col
  const shadowRect = (x0: number, y0: number, x1: number, y1: number, spread: number, strength: number) => {
    for (let k = spread; k >= 1; k--) {
      roundRect(x0 - k + 1, y0 - k + 2, x1 + k + 1, y1 + k + 3, k + 2, flat([0, 8, 5]), (strength / spread) * 0.9)
    }
  }
  const ellipse = (cx: number, cy: number, rx: number, ry: number, color: RGB, alpha = 1) => {
    if (rx <= 0 || ry <= 0) return
    for (let y = Math.max(0, Math.floor(cy - ry - 1)); y <= Math.min(h - 1, Math.ceil(cy + ry + 1)); y++) {
      for (let x = Math.max(0, Math.floor(cx - rx - 1)); x <= Math.min(w - 1, Math.ceil(cx + rx + 1)); x++) {
        const d = Math.hypot((x + 0.5 - cx) / rx, (y + 0.5 - cy) / ry)
        const cover = clamp01((1 - d) * Math.min(rx, ry) + 0.5)
        if (cover > 0) blendPixel(hd, x, y, color, cover * alpha)
      }
    }
  }
  const strokes = (set: Strokes, ox: number, oy: number, gw: number, gh: number, r: number, color: RGB) => {
    for (const s of set) {
      for (let i = 0; i + 3 < s.length; i += 2) {
        artLine(hd, ox + s[i]! * gw, oy + s[i + 1]! * gh, ox + s[i + 2]! * gw, oy + s[i + 3]! * gh, r, r, color)
      }
    }
  }

  // Table rim: jade bevel with a gold inlay line, then an inner border.
  const table = MAHJONG_TABLE
  const rimT = Math.max(3, u * 0.9)
  const tx0 = X(table.left)
  const ty0 = Y(table.top)
  const tx1 = X(table.right + 1)
  const ty1 = Y(table.bottom + 1)
  const rim = (px: number, py: number) => {
    const edge = Math.min(px - tx0, tx1 - px, py - ty0, ty1 - py)
    const t = Math.max(0, Math.min(1, edge / rimT))
    const bevelLight = px - tx0 < rimT || py - ty0 < rimT ? 1 : 0
    let col = hdMix(hdDarken(frameDim, 0.55), frame, Math.sin(t * Math.PI * 0.5))
    if (bevelLight && edge < rimT * 0.4) col = hdMix(col, [150, 255, 210], 0.3)
    if (edge > rimT * 0.55 && edge < rimT * 0.75) col = hdMix(col, accent, 0.65)
    return col
  }
  for (let y = Math.max(0, Math.floor(ty0)); y < Math.min(h, Math.ceil(ty1)); y++) {
    for (let x = Math.max(0, Math.floor(tx0)); x < Math.min(w, Math.ceil(tx1)); x++) {
      if (Math.min(x - tx0, tx1 - x, y - ty0, ty1 - y) < rimT) hd.set(x, y, rim(x + 0.5, y + 0.5))
    }
  }
  const inner = MAHJONG_INNER
  const ix0 = X(inner.left)
  const iy0 = Y(inner.top)
  const ix1 = X(inner.right + 1)
  const iy1 = Y(inner.bottom + 1)
  const line = Math.max(1, Math.round(u * 0.14))
  hd.rect(ix0, iy0, ix1, iy0 + line, frameDim)
  hd.rect(ix0, iy1 - line, ix1, iy1, frameDim)
  hd.rect(ix0, iy0, ix0 + line, iy1, frameDim)
  hd.rect(ix1 - line, iy0, ix1, iy1, frameDim)
  for (const [cx, cy] of [
    [ix0, iy0],
    [ix1, iy0],
    [ix0, iy1],
    [ix1, iy1],
  ] as const) {
    softDisk(hd, cx, cy, u * 0.5, accent)
    softDisk(hd, cx, cy, u * 0.25, hdMix(accent, white, 0.5))
  }

  // One carved tile face inside the ivory rectangle.
  const drawFace = (fx0: number, fy0: number, fx1: number, fy1: number, tileIndex: number) => {
    const face = mahjongTileFace(tileIndex)
    const fw = fx1 - fx0
    const fh = fy1 - fy0
    const cx = (fx0 + fx1) / 2
    const cy = (fy0 + fy1) / 2
    const sr = Math.max(0.8, fw * 0.036)
    if (face.family === "circles") {
      const layout = DOTS[face.count - 1]!
      const pr = face.count === 1 ? fw * 0.36 : face.count <= 3 ? fw * 0.2 : face.count <= 5 ? fw * 0.19 : fw * 0.155
      const palette: RGB[] = [
        [34, 92, 196],
        [24, 140, 84],
        [200, 44, 44],
      ]
      for (const [ox, oy, k] of layout) {
        const px = cx + ox * fw * 0.3
        const py = cy + oy * fh * 0.38
        const col = face.count === 1 ? (red as RGB) : palette[k]!
        softDisk(hd, px + pr * 0.1, py + pr * 0.14, pr, [150, 160, 150], 0.35)
        softDisk(hd, px, py, pr, hdDarken(col, 0.78))
        softDisk(hd, px, py, pr * 0.84, col)
        softDisk(hd, px, py, pr * 0.56, ivory)
        softDisk(hd, px, py, pr * 0.34, hdMix(col, white, 0.1))
        if (face.count === 1) {
          softDisk(hd, px, py, pr * 0.84, [24, 140, 84], 0.0)
          for (let k2 = 0; k2 < 8; k2++) {
            const a = (k2 / 8) * Math.PI * 2
            softDisk(hd, px + Math.cos(a) * pr * 0.7, py + Math.sin(a) * pr * 0.7, pr * 0.1, [24, 140, 84])
          }
        }
        softDisk(hd, px - pr * 0.28, py - pr * 0.3, pr * 0.16, white, 0.7)
      }
    } else if (face.family === "bamboo") {
      if (face.count === 1) {
        // Bird: green body, red crest, fan tail.
        for (let k = -2; k <= 2; k++) {
          const ex = cx + k * fw * 0.13
          const ey = cy + fh * 0.34 - Math.abs(k) * fh * 0.03
          artLine(hd, cx, cy + fh * 0.08, ex, ey, sr * 0.6, sr * 0.6, [24, 140, 84])
          softDisk(hd, ex, ey, fw * 0.065, k % 2 === 0 ? red : [34, 92, 196])
        }
        ellipse(cx, cy - fh * 0.02, fw * 0.17, fh * 0.17, [24, 140, 84])
        ellipse(cx - fw * 0.04, cy - fh * 0.06, fw * 0.08, fh * 0.08, [88, 190, 130], 0.7)
        softDisk(hd, cx + fw * 0.05, cy - fh * 0.26, fw * 0.1, [24, 140, 84])
        artLine(hd, cx + fw * 0.02, cy - fh * 0.33, cx - fw * 0.05, cy - fh * 0.4, sr * 0.5, sr * 0.3, red)
        artLine(hd, cx + fw * 0.08, cy - fh * 0.3, cx + fw * 0.18, cy - fh * 0.28, sr * 0.5, sr * 0.2, gold)
        softDisk(hd, cx + fw * 0.06, cy - fh * 0.27, Math.max(0.6, fw * 0.02), white)
      } else {
        const sw = Math.max(1.6, fw * (STICKS[face.count - 1]!.length > 6 ? 0.13 : 0.16))
        for (const [ox, oy, len, flag] of STICKS[face.count - 1]!) {
          const bx = cx + ox * fw * 0.31
          const by = cy + oy * fh * 0.38
          const half = len * fh * 0.19
          const base: RGB = flag ? red : [26, 142, 88]
          const top = by - half
          const bot = by + half
          roundRect(bx - sw / 2, top, bx + sw / 2, bot, sw * 0.45, (_px, _py, uu) =>
            hdMix(hdMix(base, white, 0.32), hdDarken(base, 0.7), clamp01(uu * 1.25)),
          )
          const nodes = Math.max(1, Math.round((bot - top) / (fh * 0.2)))
          for (let k = 0; k <= nodes; k++) {
            const ny = top + ((bot - top) * k) / nodes
            hd.rect(bx - sw * 0.62, ny - 0.5, bx + sw * 0.62, ny + 0.6, hdDarken(base, 0.5))
          }
        }
      }
    } else if (face.family === "characters") {
      strokes(NUMERALS[face.count - 1]!, cx - fw * 0.27, cy - fh * 0.42, fw * 0.54, fh * 0.3, sr, navy)
      strokes(WAN, cx - fw * 0.3, cy - fh * 0.04, fw * 0.6, fh * 0.42, sr * 1.05, red)
    } else if (face.family === "wind") {
      strokes(WINDS[face.count]!, cx - fw * 0.33, cy - fh * 0.3, fw * 0.66, fh * 0.6, sr * 1.15, navy)
    } else if (face.count === 0) {
      strokes(
        [
          [0.2, 0.28, 0.8, 0.28, 0.8, 0.7, 0.2, 0.7, 0.2, 0.28],
          [0.5, 0.06, 0.5, 0.94],
        ],
        cx - fw * 0.34,
        cy - fh * 0.34,
        fw * 0.68,
        fh * 0.68,
        sr * 1.3,
        red,
      )
    } else if (face.count === 1) {
      strokes(FA, cx - fw * 0.34, cy - fh * 0.34, fw * 0.68, fh * 0.68, sr * 1.2, [26, 142, 88])
    } else {
      for (const [k, col] of [
        [0.34, navy],
        [0.24, [70, 110, 190]],
      ] as const) {
        const rx = fw * k
        const ry = fh * k * 0.86
        const t = Math.max(1, sr * 0.9)
        hd.rect(cx - rx, cy - ry, cx + rx, cy - ry + t, col)
        hd.rect(cx - rx, cy + ry - t, cx + rx, cy + ry, col)
        hd.rect(cx - rx, cy - ry, cx - rx + t, cy + ry, col)
        hd.rect(cx + rx - t, cy - ry, cx + rx, cy + ry, col)
      }
    }
  }

  type TileOpts = {
    x: number
    y: number
    w: number
    h: number
    depth: number
    tile: number
    up: boolean
    /** Horizontal squash for flips, in (0, 1]. */
    scaleX?: number
    glow?: number
    shadow?: number
  }
  // One tile with thickness: jade body, ivory face or ivory-topped back.
  const drawTile = (o: TileOpts) => {
    const sx = Math.max(0.05, Math.min(1, o.scaleX ?? 1))
    const tw = o.w * sx
    const x0 = o.x + (o.w - tw) / 2
    const x1 = x0 + tw
    const y0 = o.y
    const yf = y0 + o.h
    const y1 = yf + o.depth
    if (o.glow) glow(hd, (x0 + x1) / 2, (y0 + y1) / 2, o.w * 2.2, gold, o.glow)
    if (o.shadow !== 0) shadowRect(x0, y0, x1, y1, Math.max(2, Math.round(u * 0.3)), o.shadow ?? 0.5)
    const rad = Math.max(1.5, Math.min(o.w, o.h) * 0.13)
    roundRect(x0, y0, x1, y1, rad, (_px, _py, uu, v) => {
      const body = hdMix(jade, jadeEdge, 0.15 + v * 0.55)
      return hdMix(body, [120, 235, 180], Math.max(0, 0.25 - uu * 0.6) * 0.5)
    })
    if (tw < 3) return
    if (o.up) {
      const fx0 = x0 + tw * 0.04
      const fx1 = x1 - tw * 0.055
      const fy0 = y0 + o.h * 0.02
      roundRect(fx0, fy0, fx1, yf, rad * 0.85, (_px, _py, uu, v) => {
        let col = hdMix(ivory, [206, 226, 214], v * 0.5)
        col = hdMix(col, white, Math.max(0, 0.45 - v * 0.9) * (1 - uu * 0.4))
        return col
      })
      hd.rect(fx0 + rad, yf - 1, fx1 - rad, yf, [168, 196, 182])
      if (sx > 0.4)
        drawFace(fx0 + (fx1 - fx0) * 0.06, fy0 + o.h * 0.05, fx1 - (fx1 - fx0) * 0.06, yf - o.h * 0.03, o.tile)
    } else {
      const strip = Math.max(1.5, o.depth * 0.9)
      roundRect(x0, y0, x1, y0 + strip + rad, rad, (_px, _py, uu, v) =>
        hdMix(ivory, [200, 222, 208], v * 0.5 + uu * 0.1),
      )
      const px0 = x0 + tw * 0.07
      const px1 = x1 - tw * 0.07
      const py0 = y0 + strip + o.h * 0.04
      const py1 = y1 - o.depth * 0.5
      roundRect(px0, py0, px1, py1, rad * 0.8, (_px, _py, uu, v) =>
        hdMix(hdMix(jade, jadeInk, 0.28), jade, Math.min(1, v * 0.9 + Math.abs(uu - 0.5) * 0.4)),
      )
      if (sx > 0.4 && px1 - px0 > 8) {
        const mx = (px0 + px1) / 2
        const my = (py0 + py1) / 2
        const rr = Math.min(px1 - px0, py1 - py0) * 0.26
        softDisk(hd, mx, my, rr, jadeInk, 0.9)
        softDisk(hd, mx, my, rr * 0.72, hdMix(jade, jadeEdge, 0.4))
        softDisk(hd, mx, my, rr * 0.28, jadeInk)
      }
    }
  }
  // A concealed side-hand tile lying on its edge: jade back with an ivory rim toward the table center.
  const drawSideBack = (x: number, y: number, tw: number, th: number, rimSide: "left" | "right", lift = 0) => {
    shadowRect(x, y - lift, x + tw, y - lift + th, 2, 0.45)
    const rad = Math.max(1.5, th * 0.3)
    roundRect(x, y - lift, x + tw, y - lift + th, rad, (_px, _py, _uu, v) => hdMix(jade, jadeEdge, 0.1 + v * 0.55))
    const strip = Math.max(2, tw * 0.17)
    const sx0 = rimSide === "right" ? x + tw - strip : x
    roundRect(sx0, y - lift, sx0 + strip, y - lift + th, rad * 0.8, (_px, _py, _uu, v) =>
      hdMix(ivory, [200, 222, 208], v * 0.5),
    )
    const px0 = rimSide === "right" ? x + tw * 0.08 : x + strip + tw * 0.03
    const px1 = rimSide === "right" ? x + tw - strip - tw * 0.03 : x + tw - tw * 0.08
    roundRect(px0, y - lift + th * 0.14, px1, y - lift + th * 0.82, rad * 0.6, (_px, _py, _uu, v) =>
      hdMix(hdMix(jade, jadeInk, 0.26), jade, v),
    )
    softDisk(hd, (px0 + px1) / 2, y - lift + th * 0.48, Math.max(1, th * 0.14), jadeInk, 0.9)
  }

  if (style === "mahjong-ending") {
    const ending = MAHJONG_ENDING_LAYOUT
    const burstT = clamp01((cycleMs - MAHJONG_WIN_BURST_MS) / 900)
    const handX = (i: number) => ending.handX + i * 3 + (i === MAHJONG_WIN_HAND.length - 1 ? 1 : 0)
    const winCx = X(handX(MAHJONG_WIN_HAND.length - 1) + 1.4)
    const winCy = Y(ending.handRow + 1.5)
    const handCx = w / 2
    const handCy = Y(ending.handRow + 1.4)

    // Gold bloom behind the hand, slow god rays, and a flash as the last tile turns.
    glow(hd, handCx, handCy, cw * 38, gold, 0.22 * burstT + 0.06)
    glow(hd, handCx, handCy, cw * 20, goldLight, 0.16 * burstT)
    if (burstT > 0) {
      const radius = Math.hypot(w, h) * 0.75
      const rot = cycle * Math.PI * 2 * 0.5
      const ya = Math.max(0, Math.floor(handCy - radius))
      const yb = Math.min(h - 1, Math.ceil(handCy + radius))
      for (let y = ya; y <= yb; y++) {
        const dy = y + 0.5 - handCy
        for (let x = 0; x < w; x++) {
          const dx = x + 0.5 - handCx
          const dist = Math.hypot(dx, dy * 1.6)
          if (dist > radius || dist < 1) continue
          const ray = 0.5 + 0.5 * Math.sin((Math.atan2(dy, dx) + rot) * 9)
          const k = ray ** 3 * (1 - dist / radius) ** 1.5 * 0.14 * burstT
          blendPixel(hd, x, y, goldLight, k)
        }
      }
    }
    const flash = Math.max(0, 1 - Math.abs(cycleMs - MAHJONG_WIN_BURST_MS) / 260)
    if (flash > 0) glow(hd, winCx, winCy, cw * 14, white, 0.5 * flash)

    // Confetti layer behind the content.
    const confetti: RGB[] = [gold, info, good, [236, 90, 90], ink, goldLight]
    const sparkle = 0.25 + 0.75 * burstT
    for (let i = 0; i < 54; i++) {
      const speed = 1 + (i % 3)
      const fall = (artHash(i, 4) + cycle * speed) % 1
      const px = artHash(i, 8) * w + Math.sin(cycle * Math.PI * 2 * speed + i) * cw * 1.4
      const py = fall * (h + 20) - 10
      const spin = Math.abs(Math.cos(cycle * Math.PI * 2 * (speed + 1) + i))
      const sw = Math.max(1, u * 0.28)
      const sh = Math.max(1, u * 0.18 * (0.3 + spin))
      roundRect(px - sw, py - sh, px + sw, py + sh, 1, flat(confetti[i % confetti.length]!), 0.85 * sparkle)
    }

    // Title plaque: gilt frame over a dark jade panel with a breathing halo.
    const title = "HAND COMPLETED"
    const px0 = X(mahjongCenterX(title) - 4)
    const px1 = X(mahjongCenterX(title) + title.length + 4)
    const py0 = Y(ending.titleRow - 0.45)
    const py1 = Y(ending.titleRow + 1.45)
    glow(hd, w / 2, (py0 + py1) / 2, cw * 24, gold, 0.2 + 0.1 * lampBreath)
    shadowRect(px0, py0, px1, py1, 4, 0.6)
    roundRect(px0, py0, px1, py1, (py1 - py0) / 2, (_px, _py, uu, v) =>
      hdMix(goldLight, goldDeep, clamp01(v * 1.1 + Math.abs(uu - 0.5) * 0.3)),
    )
    const bd = Math.max(2, u * 0.22)
    roundRect(px0 + bd, py0 + bd, px1 - bd, py1 - bd, (py1 - py0) / 2 - bd, (_px, _py, _uu, v) =>
      hdMix([6, 52, 38], [2, 26, 18], v),
    )
    for (const side of [-1, 1]) {
      const sx = side < 0 ? px0 + (py1 - py0) * 0.5 : px1 - (py1 - py0) * 0.5
      softDisk(hd, sx, (py0 + py1) / 2, (py1 - py0) * 0.12, goldLight)
    }
    blit(mahjongCenterX(title), ending.titleRow, title, accent)

    // The winning hand: every tile flips face up in turn; the winner is lifted and haloed.
    const tw = cw * 2.8
    const th = ch * 2.4
    const depth = ch * 0.4
    MAHJONG_WIN_HAND.forEach((tileIndex, i) => {
      const p = mahjongWinFlip(elapsed, i)
      const last = i === MAHJONG_WIN_HAND.length - 1
      const arc = Math.sin(p * Math.PI)
      const wave = burstT > 0 ? Math.max(0, Math.sin(cycle * Math.PI * 2 * 3 - i * 0.55)) : 0
      const lift = arc * ch * 0.7 + (last ? ch * 0.45 * burstT : 0)
      drawTile({
        x: X(handX(i)),
        y: Y(ending.handRow) - lift,
        w: tw,
        h: th,
        depth,
        tile: tileIndex,
        up: p >= 0.5,
        scaleX: Math.max(0.06, Math.abs(Math.cos(p * Math.PI))),
        glow: last ? 0.5 * burstT + 0.35 * arc : wave * 0.12 * burstT,
      })
    })
    // Sparks burst out of the winning tile once the hand is complete.
    if (burstT > 0) {
      const t = clamp01((cycleMs - MAHJONG_WIN_BURST_MS) / (MAHJONG_CYCLE_MS - MAHJONG_WIN_BURST_MS))
      const fade = 1 - t ** 3
      for (let k = 0; k < 28; k++) {
        const ang = artHash(k, 11) * Math.PI * 2
        const speed = 0.4 + artHash(k, 12)
        const d = easeOut(t * 1.3) * cw * (6 + speed * 14)
        const sxp = winCx + Math.cos(ang) * d
        const syp = winCy + Math.sin(ang) * d * 0.6 + t * t * ch * 3
        softDisk(hd, sxp, syp, Math.max(0.8, u * 0.2 * (1 - t * 0.5)), k % 3 === 0 ? white : goldLight, fade * 0.9)
        glow(hd, sxp, syp, u * 0.9, gold, 0.3 * fade)
      }
    }

    const ledger = "FINAL POINT LEDGER"
    blit(mahjongCenterX(ledger), ending.ledgerTitleRow, ledger, info)
    const rule = "- - - - - -"
    blit(mahjongCenterX(rule), ending.ledgerTitleRow - 1, rule, frame)
    blit(mahjongCenterX(rule), ending.thanksRow - 1, rule, frame)
    for (let i = 0; i < MAHJONG_SCORES.length; i++) {
      const rank = mahjongRank(i)
      const text = mahjongRankedLine(i)
      const color = hdHex(mahjongRankColor(rank))
      const row = ending.firstScoreRow + i * ending.scoreRowGap
      const x0 = X(mahjongCenterX(text) - 5)
      const x1 = X(mahjongCenterX(text) + text.length + 3)
      const y0 = Y(row) - ch * 0.15
      const y1 = Y(row + 1) + ch * 0.15
      // Translucent band, brightest for the winner, plus a score bar.
      roundRect(
        x0,
        y0,
        x1,
        y1,
        ch * 0.35,
        (_px, _py, _u, v) => hdMix(hdDarken(color, 0.3), [2, 20, 14], v * 0.5),
        rank === 1 ? 0.62 : 0.34,
      )
      const fill = (MAHJONG_SCORES[i]! / Math.max(...MAHJONG_SCORES)) * (x1 - x0 - 8)
      roundRect(x0 + 4, y1 - ch * 0.12, x0 + 4 + fill, y1 - ch * 0.02, 1, flat(color), 0.8)
      if (rank === 1) {
        glow(hd, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.7, accent, 0.14 + 0.06 * lampBreath)
        const shine = ((cycle * 2) % 1) * (x1 - x0)
        glow(hd, x0 + shine, (y0 + y1) / 2, ch * 1.4, white, 0.2)
      }
      blit(mahjongCenterX(text), row, text, color)
      // Coin medal.
      const mx = X(mahjongCenterX(text) - 2.5)
      const my = Y(row + 0.5)
      const mr = Math.max(2, Math.min(cw, ch) * 0.45)
      softDisk(hd, mx + 1, my + 2, mr, [0, 8, 5], 0.5)
      softDisk(hd, mx, my, mr, hdDarken(color, 0.7))
      softDisk(hd, mx, my, mr * 0.82, color)
      softDisk(hd, mx - mr * 0.25, my - mr * 0.28, mr * 0.35, hdMix(color, white, 0.65), 0.8)
    }
    const thanks = "THANK YOU FOR PLAYING"
    blit(mahjongCenterX(thanks), ending.thanksRow, thanks, good)
    const blink = mahjongEndingBlink(elapsed)
    const twinkle = blink ? "*   *   *" : "  *   *  "
    blit(mahjongCenterX(twinkle), ending.blinkRow, twinkle, accent)
    if (blink) {
      glow(hd, X(38.5), Y(22.5), cw * 3, accent, 0.4)
      softDisk(hd, X(38.5), Y(22.5), Math.max(1.5, Math.min(cw, ch) * 0.3), accent)
    }

    // Foreground coins tumble past the ledger.
    for (let i = 0; i < 12; i++) {
      const speed = 1 + (i % 2)
      const fall = (artHash(i, 21) + cycle * speed) % 1
      const px = artHash(i, 22) * w + Math.sin(cycle * Math.PI * 2 * speed + i * 2) * cw * 1.8
      const py = fall * (h + 40) - 20
      const spin = Math.abs(Math.cos(cycle * Math.PI * 2 * (speed + 2) + i))
      const r = Math.max(3, u * 0.55)
      const rx = Math.max(0.8, r * (0.18 + 0.82 * spin))
      ellipse(px + 1, py + 1.5, rx, r, [0, 8, 5], 0.35 * sparkle)
      ellipse(px, py, rx, r, goldDeep, sparkle)
      ellipse(px, py, rx * 0.82, r * 0.82, gold, sparkle)
      ellipse(px - rx * 0.15, py - r * 0.2, rx * 0.4, r * 0.35, goldLight, 0.7 * sparkle)
    }
    return hd.pixels
  }

  // ---- Match -------------------------------------------------------------
  const layout = MAHJONG_MATCH_LAYOUT
  const match = mahjongMatch(elapsed)
  const step = mahjongStep(elapsed)
  const f = mahjongStepProgress(elapsed)
  const turnSeat = ["SOUTH", "EAST", "NORTH", "WEST"].indexOf(match.turn)
  const pulse = 0.75 + 0.25 * Math.sin(cycle * Math.PI * 24)

  // Center plate with a gold ring, flanked by the four wall strips.
  const plate = MAHJONG_PLATE
  const plx0 = X(plate.left)
  const ply0 = Y(plate.top)
  const plx1 = X(plate.right)
  const ply1 = Y(plate.bottom)
  const plateR = (ply1 - ply0) * 0.45
  roundRect(plx0 - 3, ply0 - 3, plx1 + 3, ply1 + 3, plateR + 3, (_px, _py, _uu, v) =>
    hdMix(goldLight, goldDeep, clamp01(v * 1.2)),
  )
  roundRect(plx0, ply0, plx1, ply1, plateR, (px, py) => {
    const d = Math.hypot((px - (plx0 + plx1) / 2) / (plx1 - plx0), (py - (ply0 + ply1) / 2) / (ply1 - ply0))
    return hdMix([6, 70, 48], [2, 28, 20], clamp01(d * 1.6))
  })
  roundRect(plx0 + 4, ply0 + 4, plx1 - 4, ply1 - 4, plateR - 3, flat([4, 52, 36]), 0.0)
  glow(hd, (plx0 + plx1) / 2, (ply0 + ply1) / 2, (plx1 - plx0) * 0.45, [255, 240, 190], 0.1)
  // Wall ring: stacks disappear in order as tiles are drawn.
  {
    const remaining = Math.round(40 * (match.wall / 84))
    const stackW = cw * 1.45
    const stackH = ch * 0.8
    const stacks: { x: number; y: number; w: number; h: number }[] = []
    for (let i = 0; i < 16; i++)
      stacks.push({ x: plx0 + cw * 0.9 + i * stackW * 1.02, y: ply0 - stackH - 3, w: stackW, h: stackH })
    for (let i = 0; i < 4; i++)
      stacks.push({ x: plx1 + 2, y: ply0 + i * ((ply1 - ply0) / 4), w: stackW, h: (ply1 - ply0) / 4 - 1.5 })
    for (let i = 15; i >= 0; i--)
      stacks.push({ x: plx0 + cw * 0.9 + i * stackW * 1.02, y: ply1 + 3, w: stackW, h: stackH })
    for (let i = 3; i >= 0; i--)
      stacks.push({ x: plx0 - 2 - stackW, y: ply0 + i * ((ply1 - ply0) / 4), w: stackW, h: (ply1 - ply0) / 4 - 1.5 })
    stacks.slice(0, remaining).forEach((s) => {
      roundRect(s.x + 1, s.y + 2, s.x + s.w + 1, s.y + s.h + 2, 2, flat([0, 8, 5]), 0.5)
      roundRect(s.x, s.y, s.x + s.w - 1, s.y + s.h, 2, (_px, _py, _uu, v) => hdMix(jade, jadeEdge, 0.1 + v * 0.5))
      roundRect(s.x, s.y, s.x + s.w - 1, s.y + Math.max(2, s.h * 0.3), 2, (_px, _py, uu, v) =>
        hdMix(ivory, [196, 220, 206], v * 0.5 + uu * 0.1),
      )
    })
  }
  const viewText = "-- MATCH VIEW --"
  blit(mahjongCenterX(viewText), layout.viewRow, viewText, info)
  // Round-wind chip, dice, and point sticks on the plate.
  {
    const cy = Y(layout.diceRow - 0.15)
    const chipX = X(31)
    const cr = ch * 0.7
    softDisk(hd, chipX + 1, cy + 2, cr, [0, 8, 5], 0.5)
    softDisk(hd, chipX, cy, cr, goldDeep)
    softDisk(hd, chipX, cy, cr * 0.88, hdMix(goldLight, gold, 0.4))
    softDisk(hd, chipX, cy, cr * 0.7, [10, 70, 50])
    blit(31 - 0.5, layout.diceRow - 0.65, "E", accent)
    const dice = MAHJONG_DICE
    dice.forEach((value, d) => {
      const dx = X(36.4 + d * 3.2)
      const ds = ch * 0.55
      const dy = cy - ds / 2 + (d === 0 ? -1 : 2)
      roundRect(dx + 1.5, dy + 2.5, dx + ds + 1.5, dy + ds + 2.5, ds * 0.22, flat([0, 8, 5]), 0.5)
      roundRect(dx, dy, dx + ds, dy + ds, ds * 0.22, (_px, _py, uu, v) =>
        hdMix(hdMix(white, [208, 226, 216], v * 0.7), [180, 205, 190], uu * 0.25),
      )
      const pips: Record<number, [number, number][]> = {
        3: [
          [-1, -1],
          [0, 0],
          [1, 1],
        ],
        5: [
          [-1, -1],
          [1, -1],
          [0, 0],
          [-1, 1],
          [1, 1],
        ],
      }
      for (const [ox, oy] of pips[value] ?? [[0, 0]]) {
        softDisk(hd, dx + ds / 2 + ox * ds * 0.26, dy + ds / 2 + oy * ds * 0.26, ds * 0.11, value === 3 ? red : navy)
      }
    })
    for (let k = 0; k < 3; k++) {
      const sx0 = X(44.2)
      const sy = cy - ch * 0.42 + k * ch * 0.34
      roundRect(sx0, sy, sx0 + cw * 3.6, sy + ch * 0.2, ch * 0.1, (_px, _py, _uu, v) =>
        hdMix(white, [190, 214, 200], v),
      )
      softDisk(hd, sx0 + cw * 1.8, sy + ch * 0.1, ch * 0.065, k === 0 ? red : gold)
    }
  }

  // Turn glow under the seat on move.
  {
    const spots: [number, number][] = [
      [38, 19.5],
      [67.3, 13.5],
      [41, 5],
      [6.3, 13.5],
    ]
    const [sx, sy] = spots[turnSeat]!
    glow(hd, X(sx), Y(sy), cw * (turnSeat % 2 === 0 ? 24 : 7), accent, 0.1 * pulse)
  }

  // Deal-in: the hands settle onto the felt during the first step of the cycle.
  const dealt = (i: number) => (step === 0 ? easeOut(((elapsed % 400) - i * 12) / 180) : 1)
  const tileW = cw * 2.8
  const tileH = ch * 2.35
  const tileD = ch * 0.35
  const pondW = cw * 2.5
  const pondH = ch * 1.4
  const pondD = ch * 0.25

  // North and side hands are concealed backs; south shows faces.
  match.hands[2]!.forEach((tile, i) => {
    const p = dealt(i)
    drawTile({
      x: X(layout.northHandX + i * 3),
      y: Y(layout.northHandRow) - (1 - p) * ch * 0.5,
      w: tileW,
      h: ch * 1.95,
      depth: tileD,
      tile,
      up: false,
    })
  })
  for (let i = 0; i < 13; i++) {
    const p = dealt(i)
    drawSideBack(
      X(layout.westX),
      Y(layout.sideHandRow + i) + ch * 0.07,
      cw * 2.5,
      ch * 0.86,
      "right",
      (1 - p) * ch * 0.5,
    )
    drawSideBack(
      X(layout.eastX),
      Y(layout.sideHandRow + i) + ch * 0.07,
      cw * 2.5,
      ch * 0.86,
      "left",
      (1 - p) * ch * 0.5,
    )
  }
  match.hands[0]!.forEach((tile, i) => {
    const p = dealt(i)
    drawTile({
      x: X(layout.southHandX + i * 3),
      y: Y(layout.southHandRow) - (1 - p) * ch * 0.5,
      w: tileW,
      h: tileH,
      depth: tileD,
      tile,
      up: true,
    })
  })

  // The seat on move slides a drawn tile in from the wall.
  {
    const q = step === 0 ? 1 : easeOut(f / 0.6)
    const fromX = X(38)
    const fromY = Y(9.4)
    const draw = (toX: number, toY: number, tw: number, th: number, up: boolean, td: number) => {
      const lift = Math.sin(clamp01(f / 0.6) * Math.PI) * ch * 0.8 + (1 - q) * 0
      drawTile({
        x: fromX + (toX - fromX) * q - ((tw * (1 - q)) / 2) * 0,
        y: fromY + (toY - fromY) * q - lift - ch * 0.12 * q,
        w: tw,
        h: th,
        depth: td,
        tile: match.draw,
        up,
        glow: up ? 0.18 * q : 0,
      })
    }
    if (turnSeat === 0) draw(X(layout.southHandX + 40), Y(layout.southHandRow), tileW, tileH, true, tileD)
    else if (turnSeat === 2) draw(X(layout.northHandX + 40), Y(layout.northHandRow), tileW, ch * 1.95, false, tileD)
    else {
      const sx = turnSeat === 3 ? X(layout.westX) : X(layout.eastX)
      const ty = Y(layout.sideHandRow + 13) + ch * 0.2
      const lift = Math.sin(clamp01(f / 0.6) * Math.PI) * ch * 0.8
      drawSideBack(
        fromX + (sx - fromX) * q,
        fromY + (ty - fromY) * q,
        cw * 2.5,
        ch * 0.86,
        turnSeat === 3 ? "right" : "left",
        lift,
      )
    }
  }

  // Discard ponds: every thrown tile lies face up on the felt.
  const flying = step > 0 && f < 0.7 ? { seat: (step - 1) % 4, q: easeOut(f / 0.7) } : null
  for (let seat = 0; seat < 4; seat++) {
    match.discards[seat]!.forEach((tile, index) => {
      const isLast = step > 0 && seat === (step - 1) % 4 && index === match.discards[seat]!.length - 1
      if (isLast && flying) return
      const slot = mahjongPondSlot(seat, index)
      drawTile({ x: X(slot.x), y: Y(slot.y), w: pondW, h: pondH, depth: pondD, tile, up: true, shadow: 0.4 })
    })
  }
  if (flying) {
    const seat = flying.seat
    const index = match.discards[seat]!.length - 1
    const slot = mahjongPondSlot(seat, index)
    const tile = match.discards[seat]![index]!
    const slotPick = artHash(step, seat + 3)
    const origin =
      seat === 0
        ? { x: X(layout.southHandX + 3 * Math.floor(slotPick * 13)), y: Y(layout.southHandRow) }
        : seat === 2
          ? { x: X(layout.northHandX + 3 * Math.floor(slotPick * 13)), y: Y(layout.northHandRow) }
          : seat === 3
            ? { x: X(layout.westX), y: Y(layout.sideHandRow + Math.floor(slotPick * 13)) }
            : { x: X(layout.eastX), y: Y(layout.sideHandRow + Math.floor(slotPick * 13)) }
    const q = flying.q
    const lift = Math.sin(q * Math.PI) * ch * 1.8
    const cwTile = tileW + (pondW - tileW) * q
    const chTile = tileH + (pondH - tileH) * q
    drawTile({
      x: origin.x + (X(slot.x) - origin.x) * q,
      y: origin.y + (Y(slot.y) - origin.y) * q - lift,
      w: cwTile,
      h: chTile,
      depth: tileD + (pondD - tileD) * q,
      tile,
      up: true,
      glow: 0.3,
      shadow: 0.6,
    })
  }
  // Landing ripple and the gold marker under the newest discard.
  const marker = mahjongLatestMarker(elapsed)
  if (marker && (step === 0 || f >= 0.7 || !flying)) {
    const mx = X(marker.x + 1.25)
    const my = Y(marker.y + 0.85)
    const landed = clamp01((f - 0.55) / 0.45)
    if (landed > 0 && landed < 1) {
      const rr = cw * (1.5 + landed * 3.5)
      ellipse(mx, my - ch * 1.1, rr, rr * 0.45, gold, 0.28 * (1 - landed))
    }
    glow(hd, mx, my - ch * 0.1, cw * 3.2, accent, 0.35 * pulse)
    roundRect(X(marker.x), my - ch * 0.2, X(marker.x + 2.5), my - ch * 0.04, ch * 0.08, flat(accent))
  }

  // Seat labels: the seat on move gets a lit jade pill.
  const seatLabel = (name: string) => {
    const label = mahjongSeatLabel(name)
    if (match.turn === name) {
      const x0 = X(label.x - 1)
      const x1 = X(label.x + label.text.length + 1)
      const y0 = Y(label.y) + ch * 0.05
      const y1 = Y(label.y + 1) - ch * 0.05
      glow(hd, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) * 0.9, accent, 0.25 * pulse)
      roundRect(x0, y0, x1, y1, (y1 - y0) / 2, (_px, _py, _u, v) => hdMix(hdMix(jade, jadeInk, 0.2), jadeEdge, v * 0.6))
      blit(label.x, label.y, label.text, accent)
    } else {
      blit(label.x, label.y, label.text, ink)
    }
  }
  const title = "MAHJONG MATCH"
  blit(mahjongCenterX(title), layout.titleRow, title, accent)
  for (const name of ["NORTH", "WEST", "EAST", "SOUTH"]) seatLabel(name)
  // Dealer chip beside the south label.
  {
    const dealer = mahjongDealerMarker()
    const dcx = X(dealer.x + 1.5)
    const dcy = Y(dealer.y + 0.5)
    const dr = Math.min(cw * 1.5, ch * 0.5)
    glow(hd, dcx, dcy, dr * 2.4, accent, 0.25)
    softDisk(hd, dcx, dcy, dr, goldDeep)
    softDisk(hd, dcx, dcy, dr * 0.86, gold)
    softDisk(hd, dcx - dr * 0.25, dcy - dr * 0.3, dr * 0.3, goldLight, 0.7)
    blit(dealer.x + 1.5 - 0.5, dealer.y, "E", jadeEdge)
  }
  blit(mahjongCenterX(match.action), layout.actionRow, match.action, info)
  blit(layout.westX, layout.statusRow, `WALL: ${match.wall}`, good)
  // Wall meter: recessed track, glossy fill, and end caps.
  const fill = mahjongWallFill(match.wall)
  const barTop = Y(layout.statusRow) + ch * 0.18
  const barBottom = Y(layout.statusRow + 1) - ch * 0.18
  const bx0 = X(MAHJONG_WALL_BAR_X + 1)
  const bx1 = X(MAHJONG_WALL_BAR_X + 1 + MAHJONG_WALL_BAR_LEN)
  const bf = X(MAHJONG_WALL_BAR_X + 1 + fill)
  roundRect(bx0, barTop, bx1, barBottom, (barBottom - barTop) / 2, flat([2, 22, 15]))
  if (fill > 0) {
    roundRect(bx0, barTop, bf, barBottom, (barBottom - barTop) / 2, (_px, _py, uu, v) => {
      const base = hdMix(good, hdDarken(good, 0.65), v)
      return hdMix(base, white, Math.max(0, 0.35 - v * 0.9) * (1 - uu * 0.3))
    })
  }
  hd.rect(X(MAHJONG_WALL_BAR_X), barTop - 2, X(MAHJONG_WALL_BAR_X) + 2, barBottom + 2, ink)
  hd.rect(bx1, barTop - 2, bx1 + 2, barBottom + 2, ink)
  blit(layout.turnX, layout.statusRow, `TURN: ${match.turn}`, accent)

  return hd.pixels
}
