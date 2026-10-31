import { encode, ellipse, grid, layer, outline, paint, patch, rotate, shift, stroke, triangle } from "./akitty-pixel"
import type { Grid, Point } from "./akitty-pixel"

// Pixel red panda for AkiTTY's tab activity mark, alongside the cat, the chick,
// the dragon and the dog (one of the five is picked at random each time a
// session starts working). A rust-red panda facing front, with a white face
// mask and ear rims, black legs, and an orange-ringed tail, drawn from simple
// shapes. Its own 15 s loop: sits and sways its tail, munches a bamboo stalk
// down, rears up in the classic arms-up surprise pose, plays peekaboo behind
// its tail, curls into a ball and rolls, then waves.

type Arms = "down" | "munch" | "up" | "wave-high" | "wave-low"
type Sway = "left" | "mid" | "right"

const TAILS: Record<Sway, readonly Point[]> = {
  left: [
    [17, 24],
    [21.5, 23.5],
    [23.5, 19.5],
    [22.5, 14.5],
  ],
  mid: [
    [17, 24],
    [22, 23.5],
    [24.5, 19.5],
    [24, 14.5],
  ],
  right: [
    [17, 24],
    [22.5, 24],
    [25, 20],
    [25.5, 15],
  ],
}

const ARMS: Record<Arms, readonly (readonly Point[])[]> = {
  down: [
    [
      [9, 17],
      [10.5, 22],
    ],
    [
      [18, 17],
      [16.5, 22],
    ],
  ],
  munch: [
    [
      [9, 18],
      [12.5, 16.5],
    ],
    [
      [18, 18],
      [14.5, 16.5],
    ],
  ],
  up: [
    [
      [9, 16],
      [5, 10],
    ],
    [
      [18, 16],
      [22, 10],
    ],
  ],
  "wave-high": [
    [
      [9, 17],
      [10.5, 22],
    ],
    [
      [18, 16],
      [22, 9.5],
    ],
  ],
  "wave-low": [
    [
      [9, 17],
      [10.5, 22],
    ],
    [
      [18, 16],
      [23.5, 11.5],
    ],
  ],
}

// Rings the tail: rust bands across the orange, counted along its length.
function ringTail(g: Grid, from: Point) {
  patch(g, (x, y) => Math.floor(Math.hypot(x - from[0], y - from[1]) / 2.2) % 2 === 1, "rust", "orange")
}

// Front view, feet on row 26. `rise` lifts the head and arms for the
// hind-leg stand; `tail` sways the tail behind the body.
function pandaPose(input: {
  tail?: Sway
  arms?: Arms
  eyes?: "open" | "closed"
  mouth?: "closed" | "open"
  rise?: number
}): Grid {
  const g = grid()
  const rise = input.rise ?? 0
  const tail = TAILS[input.tail ?? "mid"]
  stroke(g, tail, 2.2, "orange")
  ringTail(g, tail[0]!)
  ellipse(g, 13.5, 21 - rise / 2, 6.5, 5.5 + rise / 2, "rust")
  ellipse(g, 10.5, 25.5, 2, 1.3, "black")
  ellipse(g, 16.5, 25.5, 2, 1.3, "black")
  for (const arm of ARMS[input.arms ?? "down"])
    stroke(
      g,
      arm.map(([x, y]): Point => [x, y - rise]),
      1.2,
      "black",
    )
  const top = 11.5 - rise
  ellipse(g, 13.5, top, 7, 5.8, "rust")
  triangle(
    g,
    [
      [7, top - 3.5],
      [6.5, top - 8.5],
      [11, top - 5.5],
    ],
    "white",
  )
  triangle(
    g,
    [
      [20, top - 3.5],
      [20.5, top - 8.5],
      [16, top - 5.5],
    ],
    "white",
  )
  const out = outline(g)
  const y = Math.round(top)
  // Dark inner ears, then the white mask: brows, cheeks and muzzle.
  paint(
    out,
    [
      [8, y - 6],
      [8, y - 5],
      [19, y - 6],
      [19, y - 5],
    ],
    "rust",
  )
  patch(out, (x, py) => ((x - 13.5) / 3) ** 2 + ((py - top - 2.5) / 2) ** 2 <= 1, "white", "rust")
  patch(out, (x, py) => ((x - 7.8) / 1.6) ** 2 + ((py - top - 1) / 1.8) ** 2 <= 1, "white", "rust")
  patch(out, (x, py) => ((x - 19.2) / 1.6) ** 2 + ((py - top - 1) / 1.8) ** 2 <= 1, "white", "rust")
  paint(
    out,
    [
      [9, y - 3],
      [10, y - 3],
      [17, y - 3],
      [18, y - 3],
    ],
    "white",
  )
  paint(
    out,
    input.eyes === "closed"
      ? [
          [9, y],
          [10, y],
          [17, y],
          [18, y],
        ]
      : [
          [10, y - 1],
          [10, y],
          [17, y - 1],
          [17, y],
        ],
    "black",
  )
  paint(
    out,
    [
      [13, y + 1],
      [14, y + 1],
    ],
    "black",
  )
  if (input.mouth === "open")
    paint(
      out,
      [
        [13, y + 3],
        [14, y + 3],
      ],
      "black",
    )
  return out
}

// A bamboo stalk held at the mouth, `length` pixels above the paws.
function bamboo(length: number): Grid {
  const g = grid()
  stroke(
    g,
    [
      [13.5, 17.5],
      [13.5, 17.5 - length],
    ],
    0.8,
    "green",
  )
  if (length > 4)
    triangle(
      g,
      [
        [13.5, 17.5 - length],
        [18, 15.5 - length],
        [14.5, 19 - length],
      ],
      "green",
    )
  return outline(g)
}

// The tail swept across the face: high hides it, low lets the eyes peek out.
function tailCover(height: "high" | "low"): Grid {
  const g = grid()
  const lift = height === "high" ? 0 : 4
  const path: Point[] = [
    [18, 24],
    [16, 19 + lift],
    [12, 14 + lift],
    [7, 12 + lift],
  ]
  stroke(g, path, 2.3, "orange")
  ringTail(g, path[0]!)
  return outline(g)
}

// Curled up: a rust ball wrapped in a ringed tail, with one white ear showing
// so the roll reads. Drawn around the frame centre so it can turn in place.
function ball(): Grid {
  const g = grid()
  ellipse(g, 13.5, 13.5, 7, 7, "rust")
  const arc: Point[] = [
    [8, 18],
    [12, 20.5],
    [17, 20],
    [20, 16],
  ]
  stroke(g, arc, 1.6, "orange")
  ringTail(g, arc[0]!)
  triangle(
    g,
    [
      [9, 9],
      [8.5, 5],
      [12.5, 7],
    ],
    "white",
  )
  const out = outline(g)
  paint(
    out,
    [
      [10, 10],
      [11, 10],
    ],
    "black",
  )
  return out
}

// Grounded: the ball's bottom rests on row 26.
const grounded = (g: Grid, dx = 0) => shift(g, dx, 6)
const sit = (tail: Sway = "mid", eyes: "open" | "closed" = "open") => pandaPose({ tail, eyes })
const SWAY: readonly Sway[] = ["mid", "right", "right", "mid", "left", "left"]

// The 15 s loop. A function, not a top-level table: program-chrome imports
// this module on every CLI start, so importing it must rasterize nothing.
const scenes = (): Grid[] => [
  // Sit, sway the tail, blink.
  ...SWAY.map((tail) => sit(tail)),
  sit("mid", "closed"),
  ...SWAY.map((tail) => sit(tail)),
  sit("mid"),
  sit("mid", "closed"),
  sit("mid"),
  // Munch a bamboo stalk down to nothing.
  ...Array.from({ length: 20 }, (_, i) => {
    const length = 10 - Math.floor(i / 3)
    const pose = pandaPose({ arms: "munch", mouth: i % 2 ? "open" : "closed", tail: SWAY[i % SWAY.length] })
    return length > 2 ? layer(pose, bamboo(length)) : pose
  }),
  // Rear up into the arms-up surprise pose, wobble, and drop back down.
  pandaPose({ rise: 1 }),
  pandaPose({ rise: 2, arms: "up" }),
  ...Array.from({ length: 10 }, (_, i) =>
    shift(pandaPose({ rise: 3, arms: "up", mouth: "open", tail: i % 2 ? "left" : "right" }), i % 4 < 2 ? 0 : 1, 0),
  ),
  pandaPose({ rise: 2, arms: "up" }),
  pandaPose({ rise: 1 }),
  sit(),
  sit(),
  // Peekaboo behind the tail.
  ...[0, 0, 0, 0].map(() => layer(sit(), tailCover("high"))),
  ...[0, 0].map(() => layer(sit(), tailCover("low"))),
  ...[0, 0, 0].map(() => layer(sit(), tailCover("high"))),
  ...[0, 0, 0].map(() => layer(pandaPose({ mouth: "open" }), tailCover("low"))),
  sit(),
  sit(),
  sit("mid", "closed"),
  sit(),
  // Curl into a ball, roll a full turn and back, and uncurl.
  grounded(ball()),
  ...[1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0].map((turns, i) => {
    let g = ball()
    for (let t = 0; t < turns; t++) g = rotate(g)
    return grounded(g, i < 6 ? Math.min(i + 1, 3) : Math.max(0, 9 - i))
  }),
  grounded(ball()),
  // Wave hello, then settle for the loop to start again.
  ...["wave-high", "wave-low", "wave-high", "wave-low", "wave-high", "wave-low", "wave-high"].map((arms) =>
    pandaPose({ arms: arms as Arms, mouth: "open" }),
  ),
  ...SWAY.map((tail) => sit(tail)),
  sit("mid", "closed"),
  ...SWAY.slice(0, 4).map((tail) => sit(tail)),
]

let frames: readonly Uint8Array[] | undefined

/** The red panda's poses as RGBA8 frames, rasterized on first call and then cached. */
export function akittyRedPandaFrames(): readonly Uint8Array[] {
  return (frames ??= scenes().map(encode))
}
export const AKITTY_RED_PANDA_FRAME_MS = 150
