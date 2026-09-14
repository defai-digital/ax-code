import { createSignal, onCleanup } from "solid-js"
import type { RGBA } from "ax-tui"
import { scheduleTuiInterval } from "@tui/util/timer"
import { encodeBrailleLines } from "@/util/braille"

// Footer busy glyph: a 5x8 dot matrix rendered as two braille lines (a braille
// cell is 2x4, so eight rows need two terminal rows). It is a matchstick man
// who walks two steps, throws a punch, then kicks — one recognizable figure in
// motion, which reads far better at this size than morphing across many
// subjects. Frames cycle directly rather than morphing one dot at a time: a
// figure should step between poses, not dissolve.
//
// The terminal tab keeps its own single-line 4x4 "A"/"X" morph
// (util/terminal-title.ts). The two surfaces deliberately do not share a frame
// set: an OSC tab title cannot span the two rows this glyph needs. ax-tui's
// <spinner> is hard-coded to one line (SpinnerRenderable.height = 1), which is
// why this renders its own two-line column instead of reusing AxTuiSpinner.
//
// Braille is East Asian Width "Narrow" and CJK-safe.
const STICKMAN_WALK_A = [".###.", ".###.", "..#..", ".##.#", "..#..", "..#..", "..##.", "##..."]
const STICKMAN_WALK_B = [".###.", ".###.", "..#..", "#.##.", "..#..", "..#..", ".##..", "...##"]
const STICKMAN_PUNCH = [".###.", ".###.", "..#..", ".#.##", "..#..", "..#..", ".#.#.", "#...#"]
const STICKMAN_KICK = [".###.", ".###.", "..#..", ".#.#.", "..#..", ".##..", ".#...", "#..##"]

// Two walking steps, then a punch and a kick.
const FOOTER_STICKMAN_SEQUENCE = [
  STICKMAN_WALK_A,
  STICKMAN_WALK_B,
  STICKMAN_WALK_A,
  STICKMAN_WALK_B,
  STICKMAN_PUNCH,
  STICKMAN_KICK,
]

export type StickmanFrame = { readonly top: string; readonly bottom: string }

export const FOOTER_STICKMAN_FRAMES: readonly StickmanFrame[] = FOOTER_STICKMAN_SEQUENCE.map((rows) => {
  const [top = "", bottom = ""] = encodeBrailleLines(rows)
  return { top, bottom }
})

export const FOOTER_STICKMAN_INTERVAL_MS = 160

export function FooterStickmanSpinner(props: { color: RGBA }) {
  const [frame, setFrame] = createSignal(0)
  const stop = scheduleTuiInterval(
    () => {
      setFrame((value) => (value + 1) % FOOTER_STICKMAN_FRAMES.length)
    },
    {
      name: "footer-stickman-tick",
      delayMs: FOOTER_STICKMAN_INTERVAL_MS,
      unref: true,
    },
  )
  onCleanup(stop)
  const current = () => FOOTER_STICKMAN_FRAMES[frame()]!
  return (
    <box flexDirection="column">
      <text fg={props.color}>{current().top}</text>
      <text fg={props.color}>{current().bottom}</text>
    </box>
  )
}
