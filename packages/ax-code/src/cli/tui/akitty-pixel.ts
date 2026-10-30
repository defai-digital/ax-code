// Pixel-art helpers shared by AkiTTY's tab activity animals (akitty-cat.ts,
// akitty-chick.ts, akitty-red-panda.ts, akitty-dragon.ts). Poses are drawn from simple shapes on
// a 28 px grid, the tab mark's size at 14 points on a 2x display, then outlined
// in black.
export const AKITTY_PIXEL_PX = 28

export const AKITTY_PIXEL_PALETTE = {
  white: [255, 255, 255],
  black: [0, 0, 0],
  orange: [255, 122, 0],
  yellow: [255, 214, 0],
  rust: [192, 64, 24],
  green: [72, 168, 64],
} as const

export type Point = readonly [number, number]
export type Pixel = keyof typeof AKITTY_PIXEL_PALETTE | undefined
export type Grid = Pixel[][]

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const

export function grid(): Grid {
  return Array.from({ length: AKITTY_PIXEL_PX }, () => Array<Pixel>(AKITTY_PIXEL_PX).fill(undefined))
}

// Every shape tests pixel centres, so poses are deterministic.
export function fill(g: Grid, inside: (x: number, y: number) => boolean, pixel: Pixel) {
  for (let y = 0; y < AKITTY_PIXEL_PX; y++) {
    for (let x = 0; x < AKITTY_PIXEL_PX; x++) if (inside(x + 0.5, y + 0.5)) g[y]![x] = pixel
  }
}

export function ellipse(g: Grid, cx: number, cy: number, rx: number, ry: number, pixel: Pixel) {
  fill(g, (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1, pixel)
}

export function triangle(g: Grid, [a, b, c]: readonly [Point, Point, Point], pixel: Pixel) {
  const side = (p: Point, q: Point, x: number, y: number) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1])
  fill(
    g,
    (x, y) => {
      const d = [side(a, b, x, y), side(b, c, x, y), side(c, a, x, y)]
      return !(d.some((v) => v < 0) && d.some((v) => v > 0))
    },
    pixel,
  )
}

// A round brush dragged along the polyline.
export function stroke(g: Grid, points: readonly Point[], radius: number, pixel: Pixel) {
  fill(
    g,
    (x, y) =>
      points.slice(1).some((end, i) => {
        const start = points[i]!
        const dx = end[0] - start[0],
          dy = end[1] - start[1]
        const t = Math.max(0, Math.min(1, ((x - start[0]) * dx + (y - start[1]) * dy) / (dx * dx + dy * dy)))
        return Math.hypot(x - start[0] - t * dx, y - start[1] - t * dy) <= radius
      }),
    pixel,
  )
}

// Empty pixels touching the silhouette become the black outline.
export function outline(g: Grid): Grid {
  const out = g.map((row) => row.slice())
  for (let y = 0; y < AKITTY_PIXEL_PX; y++) {
    for (let x = 0; x < AKITTY_PIXEL_PX; x++) {
      if (g[y]![x]) continue
      if (NEIGHBOURS.some(([dx, dy]) => g[y + dy]?.[x + dx])) out[y]![x] = "black"
    }
  }
  return out
}

// Recolours only `base` pixels, so a patch never spills past the outline.
export function patch(g: Grid, inside: (x: number, y: number) => boolean, pixel: Pixel, base: Pixel) {
  for (let y = 0; y < AKITTY_PIXEL_PX; y++) {
    for (let x = 0; x < AKITTY_PIXEL_PX; x++) if (g[y]![x] === base && inside(x + 0.5, y + 0.5)) g[y]![x] = pixel
  }
}

export function paint(g: Grid, points: readonly Point[], pixel: Pixel) {
  for (const [x, y] of points) {
    if (x >= 0 && x < AKITTY_PIXEL_PX && y >= 0 && y < AKITTY_PIXEL_PX) g[y]![x] = pixel
  }
}

// Moves a pose, clipping whatever leaves the frame.
export function shift(g: Grid, dx: number, dy: number): Grid {
  const out = grid()
  for (let y = 0; y < AKITTY_PIXEL_PX; y++) {
    for (let x = 0; x < AKITTY_PIXEL_PX; x++) {
      const pixel = g[y - dy]?.[x - dx]
      if (pixel) out[y]![x] = pixel
    }
  }
  return out
}

// Stacks poses: each later grid's pixels cover the ones before it.
export function layer(...grids: Grid[]): Grid {
  const out = grid()
  for (const g of grids) {
    for (let y = 0; y < AKITTY_PIXEL_PX; y++) {
      for (let x = 0; x < AKITTY_PIXEL_PX; x++) if (g[y]![x]) out[y]![x] = g[y]![x]
    }
  }
  return out
}

// Turns a pose a quarter turn clockwise about the frame centre.
export function rotate(g: Grid): Grid {
  return g.map((_, y) => g.map((row) => row[y]).reverse())
}

// Mirrors a pose so it faces the other way.
export function flip(g: Grid): Grid {
  return g.map((row) => row.slice().reverse())
}

// A small white "z" with a black outline so it reads on any tab colour.
export function snore(g: Grid, x: number, y: number) {
  const z: Point[] = [
    [x, y],
    [x + 1, y],
    [x + 2, y],
    [x + 1, y + 1],
    [x, y + 2],
    [x + 1, y + 2],
    [x + 2, y + 2],
  ]
  for (const [px, py] of z) {
    for (const [dx, dy] of NEIGHBOURS) if (!g[py + dy]?.[px + dx]) paint(g, [[px + dx, py + dy]], "black")
  }
  paint(g, z, "white")
}

// Straight-alpha RGBA8, fully opaque or fully transparent.
export function encode(g: Grid): Uint8Array {
  const pixels = new Uint8Array(AKITTY_PIXEL_PX * AKITTY_PIXEL_PX * 4)
  g.flat().forEach((pixel, i) => {
    if (pixel) pixels.set([...AKITTY_PIXEL_PALETTE[pixel], 255], i * 4)
  })
  return pixels
}
