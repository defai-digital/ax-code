import type { TextSceneStyle } from "./text-scene-view-model"
export type FoliageVariant = "classic-foliage" | "golden-foliage"
export type OverlayStyle = FoliageVariant | TextSceneStyle | "digital-code"
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
export type Leaf = {
  x: number
  y: number
  size: number
  speed: number
  phase: number
  swing: number
  frequency: number
  color: number
  shape: number
}
export type Foliage = { width: number; height: number; variant: FoliageVariant; leaves: Leaf[]; random: () => number }
function leaf(frame: Omit<Foliage, "leaves">, initial: boolean): Leaf {
  const random = frame.random
  return {
    x: random() * frame.width,
    // Visible on the first frame: a short opening cannot wait for a full fall.
    y: initial ? random() * (frame.height + 40) - 40 : -30,
    size: 16 + random() * 12,
    speed: 60 + random() * 90,
    phase: random() * Math.PI * 2,
    swing: 15 + random() * 30,
    frequency: 0.6 + random() * 1.2,
    color: Math.floor(random() * FOLIAGE_COLORS[frame.variant].length),
    shape: Math.floor(random() * SHAPES.length),
  }
}
export function createFoliage(width: number, height: number, variant: FoliageVariant, random = Math.random): Foliage {
  const frame = { width: Math.max(1, width), height: Math.max(1, height), variant, random }
  const count = Math.min(45, Math.max(4, Math.floor((width * height) / 4500)))
  return { ...frame, leaves: Array.from({ length: count }, () => leaf(frame, true)) }
}
export function advanceFoliage(frame: Foliage, elapsedMs: number, width = frame.width, height = frame.height): Foliage {
  if (width !== frame.width || height !== frame.height) return createFoliage(width, height, frame.variant, frame.random)
  const dt = Math.max(0, Math.min(250, elapsedMs)) / 1000
  return {
    ...frame,
    leaves: frame.leaves.map((item) => {
      const next = { ...item, y: item.y + item.speed * dt, phase: item.phase + item.frequency * dt }
      return next.y > frame.height + 30 ? leaf(frame, false) : next
    }),
  }
}
export function foliagePosition(item: Leaf, width: number) {
  return { x: (((item.x + Math.sin(item.phase) * item.swing) % width) + width) % width, y: item.y }
}
export function renderFoliagePixels(frame: Foliage): Buffer {
  const pixels = Buffer.alloc(frame.width * frame.height * 3, 5)
  for (const item of frame.leaves) {
    const position = foliagePosition(item, frame.width)
    const scale = Math.max(1, item.size / 8)
    const color = FOLIAGE_COLORS[frame.variant][item.color]!
    const shape = SHAPES[item.shape]!
    // A gentle roll complements the horizontal sway without changing fall direction.
    const angle = Math.sin(item.phase * 0.7) * 0.5
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
        if (x < 0 || y < 0 || x >= frame.width || y >= frame.height) continue
        const offset = (y * frame.width + x) * 3
        const vein = gx === 3 ? 0.65 : 1
        for (let c = 0; c < 3; c++) pixels[offset + c] = Math.round(color[c]! * vein)
      }
    }
  }
  return pixels
}
// Portable cells use small ASCII leaf outlines; no emoji or ambiguous-width glyphs.
export function foliageCells(frame: Foliage, columns: number, rows: number) {
  const grid = Array.from({ length: rows }, () =>
    Array.from({ length: columns }, () => ({ text: " ", color: "#050505" })),
  )
  for (const item of frame.leaves) {
    const position = foliagePosition(item, frame.width)
    const x = Math.floor((position.x / frame.width) * columns),
      y = Math.floor((position.y / frame.height) * rows)
    const color = "#" + FOLIAGE_COLORS[frame.variant][item.color]!.map((c) => c.toString(16).padStart(2, "0")).join("")
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
