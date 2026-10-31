import { encode, ellipse, fill, flip, grid, layer, outline, paint, shift, stroke, triangle } from "./akitty-pixel"
import type { Grid, Point } from "./akitty-pixel"

// Pixel chick for AkiTTY's tab activity mark, alongside the cat, the red panda,
// the dragon and the dog (one of the five is picked at random each time a
// session starts working). A round yellow chick with an orange beak and feet,
// drawn from simple shapes like the cat but with its own moves, in a 15 s loop:
// hatches from a wobbling egg, wears the top shell as a hat and shakes it off,
// pecks up a seed, turns to scratch the dirt, dances, dozes off standing, then
// tucks back into its egg.

type Wing = "down" | "up"

// Side view facing right, feet on row 26. `lift` lowers the whole chick for a
// squash; `peck` dips the head to the ground in front of it.
function chickPose(input: {
  wing?: Wing
  eyes?: "open" | "closed"
  beak?: "closed" | "open"
  lift?: number
  peck?: boolean
  nod?: number
  feet?: "standing" | "tucked" | "kick"
}): Grid {
  const g = grid()
  const lift = input.lift ?? 0
  const nod = input.nod ?? 0
  const head: Point = input.peck ? [20.5, 18 + lift] : [17.5 + nod / 2, 12 + lift + nod]
  // Tail feathers, body, wing (raised wings sit above the back), head and tuft.
  triangle(
    g,
    [
      [6.5, 16 + lift],
      [3, 14 + lift],
      [6, 20 + lift],
    ],
    "yellow",
  )
  ellipse(g, 12.5, 19.5 + lift, 7, 5 - lift / 2, "yellow")
  if (input.wing === "up")
    triangle(
      g,
      [
        [8, 17 + lift],
        [13, 16.5 + lift],
        [6.5, 10.5 + lift],
      ],
      "yellow",
    )
  ellipse(g, head[0], head[1], 4.5, 4.2, "yellow")
  stroke(
    g,
    [
      [head[0] - 1, head[1] - 4],
      [head[0] - 1.5, head[1] - 6],
    ],
    0.6,
    "yellow",
  )
  stroke(
    g,
    [
      [head[0], head[1] - 4],
      [head[0] + 1, head[1] - 5.8],
    ],
    0.6,
    "yellow",
  )
  const [hx, hy] = head
  if (input.peck)
    triangle(
      g,
      [
        [hx + 2, hy + 3],
        [hx + 4.5, hy + 2.5],
        [hx + 4, hy + 6.5],
      ],
      "orange",
    )
  else if (input.beak === "open") {
    triangle(
      g,
      [
        [hx + 4, hy - 1],
        [hx + 7, hy - 0.5],
        [hx + 4, hy + 0.5],
      ],
      "orange",
    )
    triangle(
      g,
      [
        [hx + 4, hy + 1.5],
        [hx + 6.5, hy + 2.5],
        [hx + 4, hy + 2.5],
      ],
      "orange",
    )
  } else
    triangle(
      g,
      [
        [hx + 4, hy - 0.5],
        [hx + 7, hy + 0.5],
        [hx + 4, hy + 1.5],
      ],
      "orange",
    )
  const out = outline(g)
  // A folded wing is a closed black teardrop on the body, tip to the back.
  const wy = Math.round(lift)
  if (input.wing !== "up")
    paint(
      out,
      [
        [13, 18],
        [12, 18],
        [11, 18],
        [10, 18],
        [9, 19],
        [8, 20],
        [9, 21],
        [10, 21],
        [11, 21],
        [12, 21],
        [13, 20],
        [14, 19],
      ].map(([x, y]): Point => [x!, y! + wy]),
      "black",
    )
  const eye = Math.round(hy - 1)
  const ex = Math.round(hx + 1.5)
  paint(
    out,
    input.eyes === "closed"
      ? [
          [ex, eye + 1],
          [ex + 1, eye + 1],
        ]
      : [
          [ex, eye],
          [ex, eye + 1],
        ],
    "black",
  )
  paint(out, [[ex - 1, eye + 3]], "orange") // cheek
  if (input.feet !== "tucked")
    paint(
      out,
      [
        [15, 25],
        [15, 26],
        [16, 26],
      ],
      "orange",
    )
  // A scratch kicks the back foot out behind.
  if (input.feet === "kick")
    paint(
      out,
      [
        [10, 24],
        [9, 24],
        [8, 25],
      ],
      "orange",
    )
  else if (input.feet !== "tucked")
    paint(
      out,
      [
        [11, 25],
        [11, 26],
        [12, 26],
      ],
      "orange",
    )
  return out
}

// The egg, split along a zigzag crack into a bottom cup and a top cap.
const EGG = { cx: 14, cy: 18.5, rx: 6.5, ry: 8 }
const CRACK: readonly Point[] = [
  [6, 17],
  [8, 15.5],
  [10, 17.5],
  [12, 15.5],
  [14, 17.5],
  [16, 15.5],
  [18, 17.5],
  [20, 15.5],
  [22, 17],
]

function crackY(x: number) {
  const i = Math.max(0, CRACK.findIndex(([px]) => px >= x) - 1)
  const [x0, y0] = CRACK[i]!
  const [x1, y1] = CRACK[i + 1] ?? CRACK[i]!
  return x1 === x0 ? y0 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
}

function eggPart(part: "whole" | "bottom" | "top", cracked = false): Grid {
  const g = grid()
  fill(
    g,
    (x, y) =>
      ((x - EGG.cx) / EGG.rx) ** 2 + ((y - EGG.cy) / EGG.ry) ** 2 <= 1 &&
      (part === "whole" || (part === "bottom") === y > crackY(x)),
    "white",
  )
  const out = outline(g)
  if (part === "whole" && cracked) {
    const line: Point[] = []
    for (let x = 9; x <= 19; x++) line.push([x, Math.round(crackY(x + 0.5) - 0.5)])
    paint(out, line, "black")
  }
  return out
}

// Where the top shell sits when the chick wears it as a hat.
const HAT: Point = [3, -8]
const wearHat = (g: Grid, dx = 0, dy = 0) => layer(g, shift(eggPart("top"), HAT[0] + dx, HAT[1] + dy))
const inCup = (chick: Grid) => layer(chick, eggPart("bottom"))

// Dust kicked up behind a scratching foot, in facing-right coordinates.
function dust(g: Grid, phase: number) {
  const specks: Point[][] = [
    [
      [6, 25],
      [5, 23],
    ],
    [
      [4, 24],
      [3, 22],
      [6, 26],
    ],
    [
      [2, 23],
      [4, 21],
    ],
  ]
  paint(g, specks[phase % specks.length]!, "black")
  return g
}

function withSeed(g: Grid) {
  paint(
    g,
    [
      [25, 26],
      [26, 26],
    ],
    "orange",
  )
  return g
}

const stand = (lift = 0) => chickPose({ lift })
const PECK: readonly boolean[] = [false, false, true, true, false, false]

const SCENES: Grid[] = [
  // Hatch: the egg wobbles, cracks, and the cap pops off.
  ...[0, -1, 0, 1].map((dx) => shift(eggPart("whole"), dx, 0)),
  ...[0, -1, 0, 1].map((dx) => shift(eggPart("whole", true), dx, 0)),
  inCup(shift(stand(), 0, 4)),
  layer(inCup(shift(stand(), 0, 3)), shift(eggPart("top"), 0, -2)),
  layer(inCup(shift(stand(), 0, 1)), shift(eggPart("top"), 1, -5)),
  ...[0, 0, 0, 0, 0].map(() => wearHat(inCup(stand()))),
  // Shake the hat off and step out of the cup.
  ...[-1, 1, -1, 1].map((dx) => shift(wearHat(inCup(stand())), dx, 0)),
  wearHat(inCup(chickPose({ wing: "up" })), 3, -4),
  wearHat(inCup(chickPose({ wing: "up", beak: "open" })), 7, -8),
  shift(chickPose({ wing: "up", feet: "tucked" }), 0, -2),
  stand(),
  // Peck three times; the seed is gone after the third.
  ...[0, 1, 2].flatMap((round) =>
    PECK.map((peck, i) => {
      const pose = chickPose({ peck })
      return round < 2 || i < 2 ? withSeed(pose) : pose
    }),
  ),
  // Turn around and scratch the dirt.
  ...Array.from({ length: 16 }, (_, i) =>
    flip(i % 4 < 2 ? stand() : dust(chickPose({ feet: "kick", lift: 1 }), i >> 2)),
  ),
  // Turn back and dance: wiggle, flap and cheep.
  ...Array.from({ length: 14 }, (_, i) =>
    shift(
      chickPose({ wing: i % 2 ? "down" : "up", beak: i % 4 === 1 ? "open" : "closed", lift: i % 2 }),
      i % 4 < 2 ? -1 : 1,
      0,
    ),
  ),
  // Doze off standing: the head droops, jerks up, droops again.
  ...[0, 1, 2, 3, 3, 3].map((nod) => chickPose({ nod, eyes: nod ? "closed" : "open" })),
  chickPose({ wing: "up", beak: "open" }),
  stand(),
  ...[1, 2, 3, 3, 3, 3].map((nod) => chickPose({ nod, eyes: "closed" })),
  chickPose({ wing: "up" }),
  stand(),
  // Tuck back into the egg and close the cap.
  inCup(stand(1)),
  inCup(shift(stand(1), 0, 2)),
  inCup(shift(stand(), 0, 4)),
  inCup(shift(stand(), 0, 6)),
  layer(inCup(shift(stand(), 0, 6)), shift(eggPart("top"), 0, -6)),
  layer(inCup(shift(stand(), 0, 6)), shift(eggPart("top"), 0, -3)),
  ...[0, 0, 0, 0, 0, 0].map(() => eggPart("whole")),
]

export const AKITTY_CHICK_FRAMES: readonly Uint8Array[] = SCENES.map(encode)
export const AKITTY_CHICK_FRAME_MS = 150
