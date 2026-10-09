import type { TextSceneStyle } from "./text-scene-view-model"
import { createHdCanvas, hdDarken, hdMix } from "./scene-hd"
import { glow } from "./atmos-paint"
export type FoliageVariant = "classic-foliage" | "golden-foliage"
export type OverlayStyle = FoliageVariant | TextSceneStyle | "digital-code"
export function isFoliageVariant(style: string | undefined): style is FoliageVariant {
  return style === "classic-foliage" || style === "golden-foliage"
}
type RGB = readonly [number, number, number]
export const FOLIAGE_COLORS: Record<FoliageVariant, readonly RGB[]> = {
  "classic-foliage": [
    [230, 57, 70],
    [244, 162, 97],
    [233, 196, 106],
    [217, 4, 41],
    [118, 117, 34],
  ],
  "golden-foliage": [
    [255, 215, 0],
    [255, 193, 37],
    [238, 180, 34],
    [218, 165, 32],
    [255, 232, 153],
  ],
}
const LEAF_SHAPE_COUNT = 3

/** Full fall-and-sway loop shared by both renderers. */
export const FOLIAGE_CYCLE_MS = 9600
/** Leaves enter above the frame and recycle below it. */
const FALL_TOP = -40
const FALL_BOTTOM_MARGIN = 30

const FOLIAGE_SEEDS: Record<FoliageVariant, number> = {
  "classic-foliage": 0x0c1a551c,
  "golden-foliage": 0x907d0f01,
}

function mulberry32(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

type Leaf = {
  x: number
  y: number
  size: number
  phase: number
  swing: number
  color: number
  shape: number
  depth: number
}

function foliageLeafCount(width: number, height: number): number {
  return Math.min(45, Math.max(4, Math.floor((width * height) / 4500)))
}

/**
 * Deterministic leaves for a millisecond. Parameters derive from a fixed
 * per-variant seed and positions from elapsed time alone, so both renderers
 * show the same leaves for the same millisecond without accumulating state.
 * Each leaf completes a whole number of falls and sways per cycle, so the
 * full scene loops with FOLIAGE_CYCLE_MS.
 */
export function foliageLeaves(width: number, height: number, variant: FoliageVariant, elapsedMs: number): Leaf[] {
  const w = Math.max(1, width),
    h = Math.max(1, height)
  // Reduce into the cycle first so loop boundaries are bit-identical instead
  // of drifting by a floating-point ulp.
  const t = Math.max(0, elapsedMs) % FOLIAGE_CYCLE_MS
  const range = h - FALL_TOP + FALL_BOTTOM_MARGIN
  return Array.from({ length: foliageLeafCount(w, h) }, (_, index) => {
    const random = mulberry32((FOLIAGE_SEEDS[variant] + index * 0x9e3779b9) >>> 0)
    const x = random() * w
    const start = random() * range
    const depth = (index % 3) / 2
    const viewportScale = Math.max(0.6, Math.min(2, Math.sqrt((w * h) / (640 * 360))))
    const size = (12 + depth * 26 + random() * 10) * viewportScale
    const rounds = 1 + Math.floor(random() * 2)
    const phase0 = random() * Math.PI * 2
    const swing = 15 + random() * 30
    const swayRounds = 1 + Math.floor(random() * 3)
    const color = Math.floor(random() * FOLIAGE_COLORS[variant].length)
    const shape = Math.floor(random() * LEAF_SHAPE_COUNT)
    const speed = (range * rounds) / FOLIAGE_CYCLE_MS
    const y = FALL_TOP + ((((start + speed * t) % range) + range) % range)
    const phase = phase0 + (2 * Math.PI * swayRounds * t) / FOLIAGE_CYCLE_MS
    return { x, y, size, phase, swing, color, shape, depth }
  })
}

function foliagePosition(item: Leaf, width: number) {
  return { x: (((item.x + Math.sin(item.phase) * item.swing) % width) + width) % width, y: item.y }
}

function foliageBackground(width: number, height: number, variant: FoliageVariant): Buffer {
  const w = Math.max(1, Math.floor(width)),
    h = Math.max(1, Math.floor(height))
  const hd = createHdCanvas(w, h, 76, 24)
  const pixels = hd.pixels
  const golden = variant === "golden-foliage"
  const sky: RGB = golden ? [35, 22, 24] : [18, 26, 30]
  const horizon: RGB = golden ? [132, 78, 38] : [96, 57, 39]
  hd.sky((v) => hdMix(sky, horizon, Math.sin(v * Math.PI * 0.85) * 0.65))
  // A hazy grove gives the leaves scale without competing with their silhouettes.
  const light: RGB = golden ? [244, 184, 99] : [198, 147, 94]
  glow(hd, hd.X(54), hd.Y(8), Math.min(w, h) * 0.4, light, 0.22)
  hd.disk(hd.X(54), hd.Y(8), Math.min(w, h) * 0.012, hdMix(light, horizon, 0.25))
  for (let i = 0; i < 11; i++) {
    const random = mulberry32(0xf07e57 + i * 977)
    const x = random() * 82 - 3
    const tint = hdMix(horizon, sky, 0.45 + random() * 0.25)
    const radius = hd.cw * (0.18 + random() * 0.35)
    const lean = random() * 3 - 1.5
    hd.stroke(x, 24, x + lean, -2, radius * 1.8, hdMix(tint, horizon, 0.25))
    hd.stroke(x, 24, x + lean, -2, radius, tint)
    for (let branch = 0; branch < 3; branch++) {
      const y = 6 + branch * 4 + random() * 2
      const reach = (i % 2 ? -1 : 1) * (3 + random() * 3)
      hd.stroke(x + 0.5, y + 4, x + reach, y, radius * 0.55, tint)
    }
  }
  // Soft distant foliage highlights stay behind the moving leaves.
  for (let i = 0; i < 32; i++) {
    const random = mulberry32(0xb0ce4 + i * 331)
    const x = random() * w
    const y = random() * h
    const r = Math.min(w, h) * (0.006 + random() * 0.012)
    hd.disk(x, y, r, hdMix(sky, horizon, 0.45 + random() * 0.35))
    hd.disk(x, y, r * 0.65, hdMix(sky, light, 0.15 + random() * 0.15))
  }
  return pixels
}

/** One immutable background per player/viewport; each frame owns its copied pixels. */
export function createFoliagePixelPainter(width: number, height: number, variant: FoliageVariant) {
  const w = Math.max(1, Math.floor(width)),
    h = Math.max(1, Math.floor(height))
  const background = foliageBackground(w, h, variant)
  const light: RGB = variant === "golden-foliage" ? [244, 184, 99] : [198, 147, 94]
  return (elapsedMs: number) => paintFoliageLeaves(w, h, variant, elapsedMs, Buffer.from(background), light)
}

export function renderFoliagePixels(width: number, height: number, variant: FoliageVariant, elapsedMs: number): Buffer {
  return createFoliagePixelPainter(width, height, variant)(elapsedMs)
}

function paintFoliageLeaves(
  w: number,
  h: number,
  variant: FoliageVariant,
  elapsedMs: number,
  pixels: Buffer,
  light: RGB,
): Buffer {
  // Paint far leaves first so nearby foliage correctly occludes it.
  for (const item of foliageLeaves(w, h, variant, elapsedMs).sort((a, b) => a.depth - b.depth)) {
    const position = foliagePosition(item, w)
    const color = FOLIAGE_COLORS[variant][item.color]!
    const angle = Math.sin(item.phase) * 0.7
    const radius = Math.ceil(item.size * 0.6)
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    const unit = item.size / 2
    const curl = 0.7 + 0.3 * Math.cos(item.phase * 2) ** 2
    // Subpixel shape samples avoid repeating trigonometry for every rotated pixel.
    const widths = new Float32Array(220)
    for (let i = 0; i < widths.length; i++) {
      const v = i / 100 - 1
      widths[i] =
        Math.sin(((v + 1) / 2) * Math.PI) *
        (item.shape === 0
          ? 0.65 + 0.25 * Math.cos(v * Math.PI * 5)
          : item.shape === 1
            ? 0.55 + 0.12 * Math.cos(v * Math.PI * 6)
            : 0.5 + 0.22 * (1 - v))
    }
    // Continuous lobes, an edge curl, and branching veins replace enlarged bitmap blocks.
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const u = (dx * cos + dy * sin) / (unit * curl)
        const v = (-dx * sin + dy * cos) / unit
        if (v < -1 || v > 1.18) continue
        const sample = (v + 1) * 100
        const lower = Math.floor(sample)
        const half = widths[lower]! + (widths[lower + 1]! - widths[lower]!) * (sample - lower)
        const edge = half - Math.abs(u)
        if (edge <= 0 && !(v > 0.78 && v < 1.18 && Math.abs(u) < 0.035)) continue
        const x = Math.round(position.x) + dx,
          y = Math.round(position.y) + dy
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const offset = (y * w + x) * 3
        const sideVein = Math.abs(((v + Math.abs(u) * 0.65 + 1.2) % 0.3) - 0.15)
        const vein = Math.abs(u) < 0.025 || (sideVein < 0.018 && Math.abs(u) > 0.08)
        const shade = vein ? 0.55 : 0.8 - u * 0.2 - v * 0.12
        const highlight = edge < 0.06 && !vein ? 0.45 : 0.06
        const alpha = (0.45 + item.depth * 0.55) * Math.min(1, Math.max(0.35, edge * unit))
        for (let c = 0; c < 3; c++) {
          const base = Math.max(0, Math.min(255, Math.round(color[c]! * shade)))
          const tint = Math.round(base + (light[c]! - base) * highlight)
          pixels[offset + c] = Math.round(pixels[offset + c]! + (tint - pixels[offset + c]!) * alpha)
        }
      }
    }
  }
  return pixels
}

// Portable cells use small ASCII leaf outlines; no emoji or ambiguous-width glyphs.
export function foliageCells(
  width: number,
  height: number,
  variant: FoliageVariant,
  elapsedMs: number,
  columns: number,
  rows: number,
) {
  const w = Math.max(1, width),
    h = Math.max(1, height)
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ text: " ", color: "#050505" })),
  )
  for (const item of foliageLeaves(w, h, variant, elapsedMs)) {
    const position = foliagePosition(item, w)
    const x = Math.floor((position.x / w) * columns),
      y = Math.floor((position.y / h) * rows)
    const color =
      "#" +
      hdDarken(FOLIAGE_COLORS[variant][item.color]!, 0.55 + item.depth * 0.45)
        .map((c) => c.toString(16).padStart(2, "0"))
        .join("")
    const shape = item.shape === 0 ? ["\\|/", "<|>", " | "] : [" /\\", " \\/", " / "]
    for (let dy = 0; dy < shape.length; dy++)
      for (let dx = 0; dx < 3; dx++) {
        const text = shape[dy]![dx]!
        if (text !== " " && grid[y + dy]?.[x + dx]) grid[y + dy]![x + dx] = { text, color }
      }
  }
  return grid.map((row) => {
    const runs: { text: string; color: string }[] = []
    for (const cell of row) {
      const last = runs.at(-1)
      if (last?.color === cell.color) last.text += cell.text
      else runs.push({ ...cell })
    }
    return runs
  })
}
