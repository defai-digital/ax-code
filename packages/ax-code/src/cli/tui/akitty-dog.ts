import * as pixel from "./akitty-pixel"
import { encode, flip, grid, layer, outline, shift } from "./akitty-pixel"
import type { Grid, Pixel, Point } from "./akitty-pixel"

// Pixel dog for AkiTTY's tab activity mark, alongside the cat, the chick, the
// red panda and the dragon (one of the five is picked at random each time a
// session starts working). An Alaskan husky: silver coat with a white face
// mask, chest, belly, legs and tail underside, curled tail, upright ears and a
// blue collar. The runner of the set, its 15 s loop: sits and wags, play-bows
// and barks, then fetches a thrown ball in full gallops right across the frame
// and beyond, chases its tail, and rolls over.

// The dog is drawn bigger than the others: every shape is scaled up about a
// point between its feet, so poses keep their simple coordinates.
const SCALE = 1.15
const ORIGIN: Point = [14, 26.5]
const up = ([x, y]: Point): Point => [ORIGIN[0] + (x - ORIGIN[0]) * SCALE, ORIGIN[1] + (y - ORIGIN[1]) * SCALE]
const down = (x: number, y: number): Point => [ORIGIN[0] + (x - ORIGIN[0]) / SCALE, ORIGIN[1] + (y - ORIGIN[1]) / SCALE]
const ellipse = (g: Grid, cx: number, cy: number, rx: number, ry: number, p: Pixel) =>
  pixel.ellipse(g, ...up([cx, cy]), rx * SCALE, ry * SCALE, p)
const stroke = (g: Grid, points: readonly Point[], radius: number, p: Pixel) =>
  pixel.stroke(g, points.map(up), radius * SCALE, p)
const triangle = (g: Grid, [a, b, c]: readonly [Point, Point, Point], p: Pixel) =>
  pixel.triangle(g, [up(a), up(b), up(c)], p)
const patch = (g: Grid, inside: (x: number, y: number) => boolean, p: Pixel, base: Pixel) =>
  pixel.patch(g, (x, y) => inside(...down(x, y)), p, base)
// Single pixels land on the pixel nearest their scaled centre.
const paint = (g: Grid, points: readonly Point[], p: Pixel) =>
  pixel.paint(
    g,
    points.map(([x, y]): Point => {
      const [sx, sy] = up([x + 0.5, y + 0.5])
      return [Math.floor(sx), Math.floor(sy)]
    }),
    p,
  )

type Legs = readonly [number, number, number, number]

// Side view facing right, feet on row 26. Leg offsets shift the far front,
// near front, far back and near back feet; `wag` swings the tail.
function dogPose(
  input: {
    legs?: Legs
    wag?: number
    mouth?: "closed" | "open"
    eyes?: "open" | "closed"
    ball?: boolean
    rise?: number
  } = {},
): Grid {
  const g = grid()
  const rise = input.rise ?? 0
  const wag = input.wag ?? 0
  const tail: Point[] = [
    [6, 16 - rise],
    [4.5 + wag, 12 - rise],
    [7 + wag, 9.5 - rise],
    [9 + wag / 2, 11.5 - rise],
  ]
  stroke(g, tail, 1.3, "silver")
  const legs = input.legs ?? [0, 0, 0, 0]
  for (const [x, offset] of [
    [18, legs[0]],
    [17, legs[1]],
    [8, legs[2]],
    [7, legs[3]],
  ] as const)
    stroke(
      g,
      [
        [x, 20 - rise],
        [x + offset, 25.5 - Math.abs(offset) / 3],
      ],
      1,
      "silver",
    )
  ellipse(g, 12.5, 18.5 - rise, 7.5, 4, "silver")
  ellipse(g, 20.5, 13 - rise, 3.8, 3.5, "silver")
  stroke(
    g,
    [
      [22.5, 14.5 - rise],
      [24.5, 15 - rise],
    ],
    1.5,
    "silver",
  )
  if (input.mouth === "open")
    stroke(
      g,
      [
        [22.5, 16.5 - rise],
        [24, 18 - rise],
      ],
      0.8,
      "silver",
    )
  triangle(
    g,
    [
      [18, 11 - rise],
      [18.8, 6.5 - rise],
      [21, 10 - rise],
    ],
    "silver",
  )
  triangle(
    g,
    [
      [20.5, 10 - rise],
      [22.3, 6.5 - rise],
      [23, 11 - rise],
    ],
    "silver",
  )
  const out = outline(g)
  const y = Math.round(13 - rise)
  // White mask below the eyes, chest, belly, legs and tail underside.
  patch(out, (x, py) => x >= 19.5 && py >= 13.5 - rise && py <= 18 - rise, "white", "silver")
  patch(out, (x, py) => ((x - 17.5) / 2.5) ** 2 + ((py - 20 + rise) / 2.6) ** 2 <= 1, "white", "silver")
  patch(out, (x, py) => py >= 20 - rise, "white", "silver")
  patch(out, (x, py) => x <= 5.5 && py <= 13.5 - rise, "white", "silver")
  // Blue collar, over silver coat and white chest alike.
  const collar = (x: number, py: number) => x >= 17 && x <= 18.6 && py >= 13 - rise && py <= 18 - rise
  patch(out, collar, "blue", "silver")
  patch(out, collar, "blue", "white")
  paint(
    out,
    [
      [19, y - 4],
      [22, y - 4],
    ],
    "white",
  )
  paint(
    out,
    input.eyes === "closed"
      ? [
          [21, y],
          [22, y],
        ]
      : [
          [21, y - 1],
          [21, y],
        ],
    "black",
  )
  paint(
    out,
    [
      [24, y + 1],
      [25, y + 1],
    ],
    "black",
  )
  if (input.mouth === "open")
    paint(
      out,
      [
        [22, y + 3],
        [23, y + 3],
        [24, y + 3],
      ],
      "black",
    )
  return input.ball ? layer(out, ball(25, 16 - rise)) : out
}

// The ball: yellow with a white seam.
function ball(x: number, y: number): Grid {
  const g = grid()
  ellipse(g, x, y, 1.9, 1.9, "yellow")
  const out = outline(g)
  paint(out, [[Math.round(x - 0.5), Math.round(y - 1.5)]], "white")
  return out
}

// Play bow: chest down, rear up, tail high.
function bow(mouth: "closed" | "open", wag: number): Grid {
  const g = grid()
  stroke(
    g,
    [
      [5, 13],
      [3 + wag, 8.5],
      [6 + wag, 6.5],
    ],
    1.3,
    "silver",
  )
  for (const [from, to] of [
    [
      [8, 16],
      [8, 25.5],
    ],
    [
      [7, 16],
      [6.5, 25.5],
    ],
    [
      [17, 22],
      [22, 25.5],
    ],
    [
      [16, 22],
      [20.5, 25.5],
    ],
  ] as const)
    stroke(g, [from, to], 1, "silver")
  ellipse(g, 9.5, 15.5, 4.5, 3.6, "silver")
  ellipse(g, 15, 19.5, 4.5, 3.2, "silver")
  ellipse(g, 20.5, 18.5, 3.6, 3.3, "silver")
  stroke(
    g,
    [
      [22.5, 20],
      [24.5, 20.5],
    ],
    1.4,
    "silver",
  )
  triangle(
    g,
    [
      [18, 16.5],
      [18.8, 12],
      [21, 15.5],
    ],
    "silver",
  )
  triangle(
    g,
    [
      [20.5, 15.5],
      [22.3, 12],
      [23, 16.5],
    ],
    "silver",
  )
  const out = outline(g)
  patch(out, (x, y) => x >= 19.5 && y >= 18.5, "white", "silver")
  patch(out, (x, y) => y >= 21, "white", "silver")
  paint(
    out,
    [
      [21, 17],
      [21, 18],
      [24, 19],
      [25, 19],
    ],
    "black",
  )
  if (mouth === "open") {
    paint(
      out,
      [
        [23, 22],
        [24, 22],
      ],
      "black",
    )
    // Bark marks in front of the snout.
    paint(
      out,
      [
        [26, 17],
        [26, 18],
        [25, 15],
        [26, 23],
      ],
      "white",
    )
  }
  return out
}

// On its back, paws up and wiggling.
function rollOver(wiggle: number): Grid {
  const g = grid()
  for (const [x, lean] of [
    [8, -1],
    [10.5, 1],
    [15.5, -1],
    [18, 1],
  ] as const)
    stroke(
      g,
      [
        [x, 20],
        [x + lean * wiggle, 14.5],
      ],
      1,
      "silver",
    )
  stroke(
    g,
    [
      [5, 22],
      [2, 24.5],
    ],
    1.3,
    "silver",
  )
  ellipse(g, 12.5, 22, 7.5, 3.6, "silver")
  ellipse(g, 21.5, 22.5, 3.6, 3.2, "silver")
  stroke(
    g,
    [
      [23.5, 24],
      [25, 24.5],
    ],
    1.3,
    "silver",
  )
  const out = outline(g)
  patch(out, (x, y) => y <= 20.5, "white", "silver")
  patch(out, (x, y) => x >= 23 && y >= 23.5, "white", "silver")
  paint(
    out,
    [
      [21, 22],
      [22, 21],
      [23, 22],
      [25, 23],
    ],
    "black",
  )
  return out
}

// Gallop: legs reach out, then gather under the body.
const GALLOP: readonly { legs: Legs; rise: number }[] = [
  { legs: [4, 3, -4, -3], rise: 1 },
  { legs: [1, 0, -1, 0], rise: 0 },
  { legs: [-2, -3, 2, 3], rise: 0 },
  { legs: [1, 2, -1, -2], rise: 1 },
]

// A full-speed run: 3 px a frame, far wider than the cat's 2 px walk.
function run(from: number, to: number, carrying = false) {
  const frames: Grid[] = []
  for (let i = 0, x = from; x <= to; i++, x += 3) {
    const stride = GALLOP[i % GALLOP.length]!
    frames.push(shift(dogPose({ ...stride, wag: -1, ball: carrying, mouth: carrying ? "closed" : "open" }), x, 0))
  }
  return frames
}

const sit = (wag = 0) => dogPose({ wag, legs: [0, 0, 2, 2] })

// The 15 s loop. A function, not a top-level table: program-chrome imports
// this module on every CLI start, so importing it must rasterize nothing.
const scenes = (): Grid[] => [
  // Stand and wag.
  ...[0, 1, 0, -1, 0, 1, 0, -1, 0, 1, 0, -1].map((wag) => sit(wag)),
  dogPose({ eyes: "closed" }),
  sit(1),
  sit(),
  sit(-1),
  // Play bow and bark.
  ...[0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 1, 0].map((open, i) => bow(open ? "open" : "closed", i % 2 ? 1 : -1)),
  // The ball flies off the right edge; the dog gallops after it, comes back
  // across the whole frame carrying it, overshoots, and returns to drop it.
  layer(sit(1), ball(24, 10)),
  layer(sit(), ball(27, 6)),
  ...run(0, 27),
  ...run(-25, 27, true),
  ...run(-25, 0, true),
  dogPose({ ball: true }),
  layer(sit(1), ball(26, 25)),
  // Chase its tail in a spin.
  ...Array.from({ length: 16 }, (_, i) => {
    const pose = shift(dogPose({ legs: i % 2 ? [2, -2, -2, 2] : [-2, 2, 2, -2], wag: 1 }), 0, i % 2 ? -1 : 0)
    return Math.floor(i / 2) % 2 ? flip(pose) : pose
  }),
  // Roll over, paws wiggling.
  ...Array.from({ length: 12 }, (_, i) => rollOver(i % 2 ? 1 : -1)),
  // Back up, wagging into the next loop.
  sit(-1),
  sit(0),
  sit(1),
]

let frames: readonly Uint8Array[] | undefined

/** The dog's poses as RGBA8 frames, rasterized on first call and then cached. */
export function akittyDogFrames(): readonly Uint8Array[] {
  return (frames ??= scenes().map(encode))
}
export const AKITTY_DOG_FRAME_MS = 150
