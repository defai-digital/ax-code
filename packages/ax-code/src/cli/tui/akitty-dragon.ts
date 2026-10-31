import { encode, ellipse, grid, layer, outline, paint, patch, shift, stroke } from "./akitty-pixel"
import type { Grid, Point } from "./akitty-pixel"

// Pixel Chinese dragon for AkiTTY's tab activity mark, alongside the cat, the
// chick, the red panda and the dog (one of the five is picked at random each
// time a session starts working). A long green serpent with a white banded
// belly and orange horns, whiskers and claws, after traditional green dragon
// art, drawn along a curve so its whole body can ripple. Its own 15 s loop:
// undulates, chases and catches the flaming pearl, breathes fire, winds into a
// turning coil, and surfs a cloud.

// The body is drawn along a centre line from tail to head.
type Path = readonly Point[]

const SEGMENTS = 24

// A ripple between two fixed ends: the middle swings while tail and head hold.
function wave(from: Point, to: Point, amplitude: number, phase: number, waves = 1.5): Path {
  const dx = to[0] - from[0],
    dy = to[1] - from[1]
  const length = Math.hypot(dx, dy)
  const nx = -dy / length,
    ny = dx / length
  return Array.from({ length: SEGMENTS + 1 }, (_, i): Point => {
    const t = i / SEGMENTS
    const offset = amplitude * Math.sin(Math.PI * t) * Math.sin(2 * Math.PI * waves * t + phase)
    return [from[0] + dx * t + nx * offset, from[1] + dy * t + ny * offset]
  })
}

// A spiral from the centre out, turned by `phase`.
function coil(phase: number): Path {
  return Array.from({ length: SEGMENTS + 1 }, (_, i): Point => {
    const t = i / SEGMENTS
    const angle = phase + 3.2 * Math.PI * t
    const radius = 1.5 + 8.6 * t
    return [13.5 + radius * Math.cos(angle), 14.5 + radius * Math.sin(angle)]
  })
}

function unit(a: Point, b: Point): Point {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return [(b[0] - a[0]) / length, (b[1] - a[1]) / length]
}

const round = ([x, y]: Point): Point => [Math.round(x - 0.5), Math.round(y - 0.5)]
const along = (p: Point, d: Point, n: Point, forward: number, up: number): Point => [
  p[0] + d[0] * forward + n[0] * up,
  p[1] + d[1] * forward + n[1] * up,
]

function dragon(path: Path, input: { mouth?: "closed" | "open"; eyes?: "open" | "closed" } = {}): Grid {
  const g = grid()
  // Tapered body, thin at the tail.
  for (let i = 0; i < path.length - 1; i++) stroke(g, [path[i]!, path[i + 1]!], 0.9 + (2 * i) / SEGMENTS, "green")
  const head = path.at(-1)!
  const d = unit(path.at(-3)!, head)
  // "Up" is whichever side of the heading points up the screen.
  const n: Point = -d[0] <= 0 ? [d[1], -d[0]] : [-d[1], d[0]]
  // Two small legs hanging from the body.
  const legs = [Math.round(SEGMENTS * 0.35), Math.round(SEGMENTS * 0.65)].map((i) => {
    const p = path[i]!
    const foot: Point = [p[0] - n[0] * 4, p[1] - n[1] * 4]
    stroke(g, [p, foot], 0.9, "green")
    return foot
  })
  ellipse(g, head[0], head[1], 3.4, 3, "green")
  stroke(g, [head, along(head, d, n, 4.2, 0.3)], 1.6, "green")
  if (input.mouth === "open") stroke(g, [along(head, d, n, 0.5, -1.5), along(head, d, n, 3.6, -2.9)], 0.9, "green")
  // Antler horns and an orange mane behind the head.
  stroke(g, [along(head, d, n, -0.8, 2), along(head, d, n, -3.5, 5.2)], 0.7, "orange")
  stroke(g, [along(head, d, n, -2.2, 3.8), along(head, d, n, -0.6, 5.4)], 0.6, "orange")
  const out = outline(g)
  // White belly bands: body pixels on the under side of the centre line.
  patch(
    out,
    (x, y) => {
      let best = 0
      let bestDistance = Infinity
      path.forEach((p, i) => {
        const distance = Math.hypot(x - p[0], y - p[1])
        if (distance < bestDistance) {
          bestDistance = distance
          best = i
        }
      })
      if (best >= SEGMENTS - 2) return false
      const p = path[best]!
      const pd = unit(path[Math.max(0, best - 1)]!, path[Math.min(SEGMENTS, best + 1)]!)
      const pn: Point = -pd[0] <= 0 ? [pd[1], -pd[0]] : [-pd[1], pd[0]]
      return (x - p[0]) * pn[0] + (y - p[1]) * pn[1] < -0.5 && best % 3 !== 0
    },
    "white",
    "green",
  )
  for (const foot of legs) paint(out, [round(foot)], "orange")
  // Eye, mouth line and a long whisker trailing back from the snout.
  const eye = round(along(head, d, n, 0.6, 1))
  if (input.eyes === "closed") paint(out, [eye, [eye[0] + 1, eye[1]]], "black")
  else {
    paint(out, [eye], "white")
    paint(out, [round(along(head, d, n, 1.4, 1))], "black")
  }
  if (input.mouth === "open")
    paint(
      out,
      [1.5, 2.3, 3.1].map((f) => round(along(head, d, n, f, -0.8))),
      "black",
    )
  paint(
    out,
    [0, 1, 2, 3, 4, 5].map((s) => round(along(head, d, n, 3.6 - s * 0.9, -1.6 - s * 0.55 - (s > 3 ? 0.4 : 0)))),
    "orange",
  )
  return out
}

// The flaming pearl the dragon chases.
function pearl(x: number, y: number): Grid {
  const g = grid()
  ellipse(g, x, y, 1.8, 1.8, "white")
  const out = outline(g)
  paint(
    out,
    [
      [Math.round(x - 0.5), Math.round(y - 3)],
      [Math.round(x + 1.5), Math.round(y - 2.5)],
    ],
    "orange",
  )
  return out
}

// Fire from the snout, `reach` pixels long, flickering by `phase`.
function fire(path: Path, reach: number, phase: number): Grid {
  const g = grid()
  const head = path.at(-1)!
  const d = unit(path.at(-3)!, head)
  for (let i = 0; i < reach; i += 2) {
    const r = 1 + i * 0.25 + ((i + phase) % 4 === 0 ? 0.4 : 0)
    ellipse(g, head[0] + d[0] * (5 + i), head[1] + d[1] * (5 + i) - 1 + ((i + phase) % 3) * 0.4, r, r * 0.8, "orange")
  }
  const out = outline(g)
  patch(
    out,
    (x, y) => Math.hypot(x - head[0] - d[0] * 6, y - head[1] - d[1] * 6 + 1) < 1.5 + reach * 0.15,
    "white",
    "orange",
  )
  return out
}

// A white cloud to ride.
function cloud(dx: number): Grid {
  const g = grid()
  for (const [x, y, r] of [
    [7, 24.5, 3],
    [12, 23, 3.8],
    [17.5, 24, 3.2],
    [21.5, 25, 2.5],
  ] as const)
    ellipse(g, x + dx, y, r, r * 0.8, "white")
  return outline(g)
}

const TAIL: Point = [1.5, 21]
const HEAD: Point = [21.5, 10.5]
const swim = (phase: number, amplitude = 5) => dragon(wave(TAIL, HEAD, amplitude, phase))

// The 15 s loop. A function, not a top-level table: program-chrome imports
// this module on every CLI start, so importing it must rasterize nothing.
const scenes = (): Grid[] => [
  // Undulate in place.
  ...Array.from({ length: 20 }, (_, i) => swim(i * 0.63)),
  // Chase the pearl around a loop, then catch it.
  ...Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 20) * 2 * Math.PI - Math.PI / 2
    const target: Point = [15 + 6 * Math.cos(angle), 12 + 6 * Math.sin(angle)]
    const head: Point = [target[0] - 3 * Math.cos(angle + 0.9), target[1] - 3 * Math.sin(angle + 0.9)]
    const caught = i >= 20
    const body = dragon(wave(TAIL, caught ? HEAD : head, 4.5, i * 0.7), { mouth: caught ? "closed" : "open" })
    return caught ? body : layer(body, pearl(target[0], target[1]))
  }),
  // Breathe fire.
  ...Array.from({ length: 16 }, (_, i) => {
    const path = wave([1.5, 21], [15, 12.5], 3.5, i * 0.5)
    const reach = i < 2 ? 0 : i < 13 ? Math.min(8, (i - 1) * 2) : 0
    const body = dragon(path, { mouth: i < 14 ? "open" : "closed" })
    return reach ? layer(body, fire(path, reach, i)) : body
  }),
  // Wind into a coil that turns.
  ...Array.from({ length: 16 }, (_, i) => dragon(coil(i * 0.4))),
  // Surf a cloud, bobbing.
  ...Array.from({ length: 16 }, (_, i) => {
    const bob = i % 4 < 2 ? 0 : 1
    return layer(
      shift(dragon(wave([1.5, 17], [21.5, 9.5], 3.5, i * 0.5), { eyes: i === 9 ? "closed" : "open" }), 0, bob - 2),
      cloud(bob ? 1 : 0),
    )
  }),
  // Back to swimming for a seamless restart.
  ...Array.from({ length: 8 }, (_, i) => swim(i * 0.79)),
]

let frames: readonly Uint8Array[] | undefined

/** The dragon's poses as RGBA8 frames, rasterized on first call and then cached. */
export function akittyDragonFrames(): readonly Uint8Array[] {
  return (frames ??= scenes().map(encode))
}
export const AKITTY_DRAGON_FRAME_MS = 150
