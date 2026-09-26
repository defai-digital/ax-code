import type { TextSceneStyle } from "./text-scene-view-model"
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
// Original monochrome leaf silhouettes, with a stem and distinct lobes.
const SHAPES = [
  [8, 42, 28, 127, 62, 28, 8, 8],
  [8, 28, 62, 62, 28, 28, 8, 8],
  [2, 14, 30, 62, 60, 56, 16, 32],
]

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
    const size = 16 + random() * 12
    const rounds = 1 + Math.floor(random() * 2)
    const phase0 = random() * Math.PI * 2
    const swing = 15 + random() * 30
    const swayRounds = 1 + Math.floor(random() * 3)
    const color = Math.floor(random() * FOLIAGE_COLORS[variant].length)
    const shape = Math.floor(random() * SHAPES.length)
    const speed = (range * rounds) / FOLIAGE_CYCLE_MS
    const y = FALL_TOP + ((((start + speed * t) % range) + range) % range)
    const phase = phase0 + (2 * Math.PI * swayRounds * t) / FOLIAGE_CYCLE_MS
    return { x, y, size, phase, swing, color, shape }
  })
}

function foliagePosition(item: Leaf, width: number) {
  return { x: (((item.x + Math.sin(item.phase) * item.swing) % width) + width) % width, y: item.y }
}

export function renderFoliagePixels(width: number, height: number, variant: FoliageVariant, elapsedMs: number): Buffer {
  const w = Math.max(1, Math.floor(width)),
    h = Math.max(1, Math.floor(height))
  const pixels = Buffer.alloc(w * h * 3, 5)
  for (const item of foliageLeaves(w, h, variant, elapsedMs)) {
    const position = foliagePosition(item, w)
    const scale = Math.max(1, item.size / 8)
    const color = FOLIAGE_COLORS[variant][item.color]!
    const shape = SHAPES[item.shape]!
    // A gentle roll complements the horizontal sway without changing fall direction.
    const angle = Math.sin(item.phase) * 0.5
    const radius = Math.ceil(item.size * 0.75)
    const cos = Math.cos(angle),
      sin = Math.sin(angle)
    // Inverse sampling leaves no holes when the silhouette rotates.
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const gx = Math.floor((dx * cos + dy * sin + item.size / 2) / scale)
        const gy = Math.floor((-dx * sin + dy * cos + item.size / 2) / scale)
        if (gx < 0 || gx >= 7 || gy < 0 || gy >= 8 || !((shape[gy] ?? 0) & (1 << (6 - gx)))) continue
        const x = Math.round(position.x) + dx,
          y = Math.round(position.y) + dy
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const offset = (y * w + x) * 3
        const vein = gx === 3 ? 0.65 : 1
        for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(color[c]! * vein)
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
    const color = "#" + FOLIAGE_COLORS[variant][item.color]!.map((c) => c.toString(16).padStart(2, "0")).join("")
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
