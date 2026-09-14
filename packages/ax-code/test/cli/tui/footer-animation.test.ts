import { describe, expect, test } from "vitest"
import {
  FOOTER_ANIMAL_EMOJI,
  FOOTER_ANIMAL_SHUFFLE_MS,
  pickRandomPair,
} from "../../../src/cli/cmd/tui/component/footer-animation"

// The renderer lays out astral-plane emoji as two cells (like CJK) but gives a
// base emoji plus U+FE0F a single cell, which would misalign the footer.
const isAstralEmoji = (value: string) =>
  [...value].every((char) => (char.codePointAt(0) ?? 0) >= 0x1f000) && !value.includes("\uFE0F")

describe("footer animal emoji", () => {
  test("keeps a large, unique, astral-only animal pool", () => {
    expect(FOOTER_ANIMAL_EMOJI.length).toBeGreaterThanOrEqual(30)
    expect(new Set(FOOTER_ANIMAL_EMOJI).size).toBe(FOOTER_ANIMAL_EMOJI.length)
    for (const emoji of FOOTER_ANIMAL_EMOJI) {
      expect(isAstralEmoji(emoji)).toBe(true)
    }
    expect(FOOTER_ANIMAL_SHUFFLE_MS).toBe(3000)
  })

  test("picks two distinct animals for the two slots", () => {
    expect(pickRandomPair(4, () => 0)).toEqual([0, 1])
    expect(pickRandomPair(4, () => 0.999)).toEqual([3, 2])
    expect(pickRandomPair(2, () => 0)).toEqual([0, 1])
    // A one-entry pool cannot fill two slots with distinct animals.
    expect(pickRandomPair(1)).toEqual([0, 0])

    for (let draw = 0; draw < 50; draw++) {
      const [left, right] = pickRandomPair(FOOTER_ANIMAL_EMOJI.length)
      expect(left).not.toBe(right)
      expect(FOOTER_ANIMAL_EMOJI[left]).toBeDefined()
      expect(FOOTER_ANIMAL_EMOJI[right]).toBeDefined()
    }
  })
})
