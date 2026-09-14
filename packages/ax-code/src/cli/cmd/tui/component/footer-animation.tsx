import { createSignal, onCleanup } from "solid-js"
import { scheduleTuiInterval } from "@tui/util/timer"

// Footer busy indicator: two animal emoji shown side by side, picked at random
// from a broad animal pool and reshuffled every three seconds.
//
// These are real Unicode emoji, not braille dot-matrix glyphs (the terminal tab
// keeps its own 4x4 "A"/"X" matrix in util/terminal-title.ts). Every entry is an
// astral-plane emoji (U+1F000 and above), which this renderer gives a fixed
// two-cell width like CJK. Emoji built from a base symbol plus U+FE0F measure
// one cell here and would misalign the footer, so none are included.
//
// The look is the terminal's own emoji font; no OpenMoji assets are bundled.
// OpenMoji (https://openmoji.org) designs these same Unicode codepoints under
// CC BY-SA 4.0 (attribution + share-alike), and its font ships as an
// experimental beta — so a user who wants that style installs the OpenMoji font
// in their terminal. An app cannot select a terminal font, and CC BY-SA art
// cannot be vendored into this Apache-2.0 tree.
export const FOOTER_ANIMAL_EMOJI: readonly string[] = [
  "🐀",
  "🐁",
  "🐂",
  "🐃",
  "🐄",
  "🐅",
  "🐆",
  "🐇",
  "🐈",
  "🐉",
  "🐊",
  "🐋",
  "🐌",
  "🐍",
  "🐎",
  "🐏",
  "🐐",
  "🐑",
  "🐒",
  "🐓",
  "🐔",
  "🐕",
  "🐖",
  "🐗",
  "🐘",
  "🐙",
  "🐛",
  "🐜",
  "🐝",
  "🐞",
  "🐟",
  "🐠",
  "🐡",
  "🐢",
  "🐣",
  "🐤",
  "🐥",
  "🐦",
  "🐧",
  "🐨",
  "🐩",
  "🐪",
  "🐫",
  "🐬",
  "🐭",
  "🐮",
  "🐯",
  "🐰",
  "🐱",
  "🐲",
  "🐳",
  "🐴",
  "🐵",
  "🐶",
  "🐷",
  "🐸",
  "🐹",
  "🐺",
  "🐻",
  "🐼",
  "🐿",
  "🦁",
  "🦂",
  "🦃",
  "🦄",
  "🦅",
  "🦆",
  "🦇",
  "🦈",
  "🦉",
  "🦊",
  "🦋",
  "🦌",
  "🦍",
  "🦎",
  "🦏",
  "🦐",
  "🦑",
  "🦒",
  "🦓",
  "🦔",
  "🦕",
  "🦖",
  "🦗",
  "🦘",
  "🦙",
  "🦚",
  "🦛",
  "🦜",
  "🦝",
  "🦞",
  "🦟",
  "🦡",
  "🦢",
  "🦥",
  "🦦",
  "🦧",
  "🦨",
  "🦩",
  "🦫",
  "🦬",
  "🦭",
  "🦮",
  "🪲",
  "🪳",
  "🪰",
  "🪱",
]

export const FOOTER_ANIMAL_SHUFFLE_MS = 3000

/** Pick two distinct indices from the pool; the order is randomised too. */
export function pickRandomPair(count: number, random: () => number = Math.random): [number, number] {
  if (count <= 1) return [0, 0]
  const first = Math.min(count - 1, Math.floor(random() * count))
  const shortlist = Math.min(count - 2, Math.floor(random() * (count - 1)))
  const second = shortlist >= first ? shortlist + 1 : shortlist
  return [first, second]
}

export function FooterAnimationSpinner() {
  const [pair, setPair] = createSignal(pickRandomPair(FOOTER_ANIMAL_EMOJI.length))

  const stop = scheduleTuiInterval(
    () => {
      setPair(pickRandomPair(FOOTER_ANIMAL_EMOJI.length))
    },
    { name: "footer-emoji-shuffle", delayMs: FOOTER_ANIMAL_SHUFFLE_MS, unref: true },
  )
  onCleanup(stop)

  const animal = (index: number) => FOOTER_ANIMAL_EMOJI[index] ?? ""

  return (
    <box flexDirection="row">
      <text>{animal(pair()[0])}</text>
      <text> {animal(pair()[1])}</text>
    </box>
  )
}
