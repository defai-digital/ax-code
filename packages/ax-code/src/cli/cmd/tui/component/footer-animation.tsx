import { createSignal, onCleanup } from "solid-js"
import { scheduleTuiInterval } from "@tui/util/timer"
import { brailleDotBit } from "@/util/braille"

// Footer busy indicator: the A/X brand mark as a 4x4 braille dot matrix (two
// full 8-dot cells on a single terminal line). It holds each letter, then morphs
// to the other one dot at a time, so a busy session shows a small brand pulse in
// the footer.
//
// The terminal tab keeps a static "AX-Code" title (util/terminal-title.ts); the
// animation lives here, not in the tab, because an OSC tab title cannot span the
// braille matrix and is not a good animation surface.
//
// Braille is East Asian Width "Narrow" and CJK-safe. The ambiguous-width block
// glyphs the old "Knight Rider" scanner used drift CJK layouts, so braille is
// the only dot-matrix family this glyph may use.
const FOOTER_GLYPH_ROWS = 4
const FOOTER_GLYPH_COLUMNS = 4

// "A" and "X" drawn as #/. row-major in the 4x4 matrix. Four dot rows is the
// most a single terminal line can hold (a braille cell is 2x4).
const FOOTER_GLYPH_A = [".##.", "#..#", "####", "#..#"]
const FOOTER_GLYPH_X = ["#..#", ".##.", ".##.", "#..#"]

// A -> X, then back to A, so the mark pulses between the two letters.
const FOOTER_GLYPH_SEQUENCE = [FOOTER_GLYPH_A, FOOTER_GLYPH_X]

// Frames each glyph is held before the next morph begins.
const FOOTER_GLYPH_DWELL_FRAMES = 3

function footerGlyphDots(rows: readonly string[]): Set<number> {
  const dots = new Set<number>()
  rows.forEach((row, r) => {
    for (let c = 0; c < FOOTER_GLYPH_COLUMNS; c++) {
      if (row.charAt(c) === "#") dots.add(r * FOOTER_GLYPH_COLUMNS + c)
    }
  })
  return dots
}

function encodeFooterGlyph(dots: ReadonlySet<number>): string {
  let glyph = ""
  for (let cell = 0; cell < FOOTER_GLYPH_COLUMNS / 2; cell++) {
    let mask = 0
    for (let r = 0; r < FOOTER_GLYPH_ROWS; r++) {
      for (let c = 0; c < 2; c++) {
        if (dots.has(r * FOOTER_GLYPH_COLUMNS + cell * 2 + c)) mask |= brailleDotBit(r, c)
      }
    }
    glyph += String.fromCharCode(0x2800 + mask)
  }
  return glyph
}

// Frame path: hold each glyph, then morph to the next one dot at a time.
// Consecutive frames differ by at most one dot, so the morph reads as one
// travelling change rather than a redraw. The last morph lands back on the first
// glyph, so the cycle repeats seamlessly.
function footerGlyphMorphFrames(): string[] {
  const glyphs = FOOTER_GLYPH_SEQUENCE.map(footerGlyphDots)
  const frames: string[] = []
  for (let i = 0; i < glyphs.length; i++) {
    const current = glyphs[i]!
    const next = glyphs[(i + 1) % glyphs.length]!
    for (let hold = 0; hold < FOOTER_GLYPH_DWELL_FRAMES; hold++) frames.push(encodeFooterGlyph(current))
    const morph = new Set(current)
    for (const dot of [...current].filter((dot) => !next.has(dot))) {
      morph.delete(dot)
      frames.push(encodeFooterGlyph(morph))
    }
    for (const dot of [...next].filter((dot) => !current.has(dot))) {
      morph.add(dot)
      frames.push(encodeFooterGlyph(morph))
    }
  }
  return frames
}

export const FOOTER_ANIMATION_FRAMES = footerGlyphMorphFrames()

// 26 frames (2 glyphs x 3 dwell + 20 one-dot morphs) pulse A <-> X in ~1.8s.
export const FOOTER_ANIMATION_INTERVAL_MS = 70

export function FooterAnimationSpinner() {
  const [frame, setFrame] = createSignal(0)

  const stop = scheduleTuiInterval(
    () => {
      setFrame((value) => (value + 1) % FOOTER_ANIMATION_FRAMES.length)
    },
    {
      name: "footer-glyph-tick",
      delayMs: FOOTER_ANIMATION_INTERVAL_MS,
      unref: true,
    },
  )
  onCleanup(stop)

  return (
    <box flexDirection="row">
      <text>{FOOTER_ANIMATION_FRAMES[frame()]!}</text>
    </box>
  )
}
