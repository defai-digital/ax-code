import { encode, ellipse, grid, outline, paint, patch, shift, snore, stroke, triangle } from "./akitty-pixel"
import type { Grid, Point } from "./akitty-pixel"

// Pixel cat for AkiTTY's tab activity mark: a white calico with orange and
// black patches, an orange collar and the AkiTTY icon's ">" wink. While a
// session works it plays a 15 s loop: sits and swishes its tail, walks off one
// edge and back in from the other, jumps, naps, then wakes and winks. Original
// artwork drawn from simple shapes, so each pose stays readable at 28 px
// (14 points on a 2x display).
// Three colours only: white fur, true black line work, vibrant orange.

type Tail = "down" | "mid" | "up"
type Eyes = "open" | "closed" | "wink"
type Ear = "still" | "twitch"

const TAILS: Record<Tail, readonly Point[]> = {
  down: [
    [18, 24.5],
    [22, 25],
    [24.5, 23],
    [25.5, 20],
  ],
  mid: [
    [18, 24.5],
    [22, 24.5],
    [24.5, 21.5],
    [24.5, 18],
  ],
  up: [
    [18, 24.5],
    [22, 23.5],
    [23.5, 20],
    [23, 16.5],
  ],
}

const EYES: Record<Eyes, readonly Point[]> = {
  open: [
    [10, 11],
    [10, 12],
    [17, 11],
    [17, 12],
  ],
  closed: [
    [9, 12],
    [10, 12],
    [17, 12],
    [18, 12],
  ],
  // The icon's face: ">" on the left, "-" on the right.
  wink: [
    [9, 10],
    [10, 11],
    [9, 12],
    [16, 12],
    [17, 12],
    [18, 12],
  ],
}

function sitPose(tail: Tail, eyes: Eyes, ear: Ear): Grid {
  let g = grid()
  stroke(g, TAILS[tail], 1.2, "white") // behind the body
  ellipse(g, 13.5, 20.5, 6.5, 5.5, "white")
  ellipse(g, 13.5, 11.5, 7.5, 6, "white")
  triangle(g, [[6.5, 9], ear === "still" ? [6, 1.5] : [5, 3], [11, 6]], "white")
  triangle(
    g,
    [
      [16, 6],
      [21, 1.5],
      [20.5, 9],
    ],
    "white",
  )
  g = outline(g)
  const leftEar: Point[] =
    ear === "still"
      ? [
          [7, 6],
          [7, 7],
          [8, 7],
        ]
      : [
          [6, 7],
          [7, 7],
          [7, 8],
        ]
  // Calico patches stay inside the fur: orange over the left ear and brow,
  // black on the back, and an orange tail tip.
  patch(g, (x, y) => ((x - 8) / 4.5) ** 2 + ((y - 6) / 4) ** 2 <= 1, "orange", "white")
  patch(g, (x, y) => ((x - 18.5) / 3) ** 2 + ((y - 21) / 3) ** 2 <= 1, "black", "white")
  patch(g, (x, y) => x >= 23 && y <= 21, "orange", "white")
  // Inner ears contrast with the ear: white inside the orange one, orange inside the white one.
  paint(g, leftEar, "white")
  paint(
    g,
    [
      [19, 6],
      [19, 7],
      [18, 7],
    ],
    "orange",
  )
  paint(g, EYES[eyes], "black")
  paint(
    g,
    [
      [13, 14],
      [14, 14],
    ],
    "orange",
  )
  paint(
    g,
    Array.from({ length: 8 }, (_, i): Point => [10 + i, 17]),
    "orange",
  )
  paint(
    g,
    [
      [12, 24],
      [12, 25],
      [15, 24],
      [15, 25],
    ],
    "black",
  )
  return g
}

type Legs = readonly [number, number, number, number]

// Side view facing right, feet on row 26. Leg offsets shift the far front,
// near front, far back and near back feet.
function sidePose(input: {
  legs?: Legs
  tail: number
  eyes: "open" | "closed"
  crouch?: number
  lying?: boolean
}): Grid {
  const g = grid()
  const lift = input.crouch ?? 0
  if (input.lying) {
    stroke(
      g,
      [
        [5, 22],
        [3, 25],
        [9, 26],
        [14, 26],
      ],
      1.2,
      "white",
    )
    ellipse(g, 12, 22.5, 7.5, 3.5, "white")
    ellipse(g, 20, 20.5, 4.5, 3.8, "white")
  } else {
    stroke(
      g,
      [
        [5, 18 + lift],
        [2.5, 15 + lift],
        [2 + input.tail, 10.5 + lift],
      ],
      1.2,
      "white",
    )
    const legs = input.legs ?? [0, 0, 0, 0]
    const feet: [number, number][] = [
      [17, legs[0]],
      [16, legs[1]],
      [8, legs[2]],
      [7, legs[3]],
    ]
    for (const [x, offset] of feet)
      stroke(
        g,
        [
          [x, 21 + lift],
          [x + offset, 25.5],
        ],
        0.9,
        "white",
      )
    ellipse(g, 12, 19 + lift, 7, 4, "white")
    ellipse(g, 20, 13 + lift, 4.5, 4, "white")
  }
  const head = input.lying ? 7.5 : lift
  triangle(
    g,
    [
      [16.5, 11 + head],
      [17.5, 6 + head],
      [19.5, 9.5 + head],
    ],
    "white",
  )
  triangle(
    g,
    [
      [20.5, 9.5 + head],
      [22.5, 6 + head],
      [23.5, 11 + head],
    ],
    "white",
  )
  const out = outline(g)
  const back = input.lying ? 3.5 : lift
  patch(out, (x, y) => ((x - 19) / 3.5) ** 2 + ((y - 9 - head) / 3) ** 2 <= 1, "orange", "white")
  patch(out, (x, y) => ((x - 10) / 3.5) ** 2 + ((y - 16.5 - back) / 2) ** 2 <= 1, "black", "white")
  if (input.lying) patch(out, (x, y) => x >= 12 && y >= 25.5, "orange", "white")
  else {
    patch(out, (x, y) => x >= 15.5 && x <= 17 && y >= 14 + lift && y <= 19 + lift, "orange", "white")
    patch(out, (x, y) => y <= 12 + lift && x <= 4.5, "orange", "white")
  }
  const eye = Math.round(12 + head)
  paint(
    out,
    input.eyes === "open"
      ? [
          [21, eye],
          [21, eye + 1],
        ]
      : [
          [21, eye + 1],
          [22, eye + 1],
        ],
    "black",
  )
  paint(out, [[24, eye + 2]], "orange")
  return out
}

// Walk cycle: diagonal leg pairs swing together.
const STRIDE: readonly Legs[] = [
  [2, -2, -2, 2],
  [1, -1, -1, 1],
  [-2, 2, 2, -2],
  [-1, 1, 1, -1],
]

function walk(from: number, to: number, step: number) {
  const frames: Grid[] = []
  for (let i = 0, x = from; x <= to; i++, x += step)
    frames.push(shift(sidePose({ legs: STRIDE[i % STRIDE.length], tail: i % 2, eyes: "open" }), x, 0))
  return frames
}

function sitting(tails: readonly Tail[], eyes: Eyes = "open", ear: Ear = "still") {
  return tails.map((tail) => sitPose(tail, eyes, ear))
}

const SWISH: readonly Tail[] = ["mid", "up", "up", "mid", "down"]
const JUMP_ARC = [-3, -6, -8, -9, -9, -8, -6, -3]
const stand = (crouch = 0) => sidePose({ tail: 0, eyes: "open", crouch })

const SCENES: Grid[] = [
  // Sit: swish, blink, swish, ear twitch.
  ...sitting(["down", ...SWISH]),
  ...sitting(["down"], "closed"),
  ...sitting(["down", ...SWISH]),
  ...sitting(["down"], "open", "twitch"),
  ...sitting(["down"]),
  ...sitting(["down"], "open", "twitch"),
  ...sitting(["down", "down"]),
  // Walk off the right edge, then back in from the left.
  ...walk(0, 22, 2),
  ...walk(-20, 0, 2),
  // Crouch, leap, land.
  stand(1),
  stand(2),
  ...JUMP_ARC.map((dy, i) =>
    shift(sidePose({ legs: i < 4 ? [3, 3, -3, -3] : [1, 1, -1, -1], tail: 1, eyes: "open" }), 0, dy),
  ),
  stand(2),
  stand(1),
  // Look around, blink.
  stand(),
  stand(),
  sidePose({ tail: 1, eyes: "closed" }),
  sidePose({ tail: 1, eyes: "open" }),
  stand(),
  stand(),
  stand(),
  // Curl up and nap while "z"s drift up.
  ...Array.from({ length: 28 }, (_, i) => {
    const g = sidePose({ tail: 0, eyes: "closed", lying: true })
    if (i >= 3) snore(g, 23 + (i % 8 >= 4 ? 1 : 0), 11 - (i % 8))
    return g
  }),
  // Wake, sit up, and give the icon's wink.
  sidePose({ tail: 0, eyes: "open", lying: true }),
  sidePose({ tail: 0, eyes: "open", lying: true }),
  ...sitting(["down", "mid", "up", "mid", "down", "down", "down"]),
  ...sitting(["down", "down", "down"], "wink"),
]

export const AKITTY_CAT_FRAMES: readonly Uint8Array[] = SCENES.map(encode)
export const AKITTY_CAT_FRAME_MS = 150
