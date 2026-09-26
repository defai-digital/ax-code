import { describe, expect, test, vi } from "vitest"
import { chooseAnimationPair, launchAnimationPair } from "../../../src/cli/tui/component/animation-pair"

describe("launch animation pairing", () => {
  test.each([
    [[0, 0.05, 1 / 9 - Number.EPSILON], { opening: "digital-code", ending: "digital-code" }],
    [[1 / 9, 1.5 / 9, 2 / 9 - Number.EPSILON], { opening: "classic-foliage", ending: "golden-foliage" }],
    [[2 / 9, 2.5 / 9, 3 / 9 - Number.EPSILON], { opening: "midnight-dream", ending: "sunset-serenade" }],
    [[3 / 9, 3.5 / 9, 4 / 9 - Number.EPSILON], { opening: "fuji-day", ending: "fuji-night" }],
    [[4 / 9, 4.5 / 9, 5 / 9 - Number.EPSILON], { opening: "mahjong-match", ending: "mahjong-ending" }],
    [[5 / 9, 5.5 / 9, 6 / 9 - Number.EPSILON], { opening: "city-night", ending: "city-dawn" }],
    [[6 / 9, 6.5 / 9, 7 / 9 - Number.EPSILON], { opening: "festival-fireworks", ending: "festival-lanterns" }],
    [[7 / 9, 7.5 / 9, 8 / 9 - Number.EPSILON], { opening: "snowfall", ending: "winter-night" }],
    [[8 / 9, 0.95, 0.999999], { opening: "volcano-eruption", ending: "volcano-calm" }],
  ] as [number[], { opening: string; ending: string }][])("draw %s selects %s", (draws, pair) => {
    for (const draw of draws) expect(chooseAnimationPair(() => draw)).toEqual(pair)
  })
  test("reading previews and the ending never draws again or changes the opening", () => {
    const random = vi
      .fn()
      .mockReturnValueOnce(0.05)
      .mockReturnValue(1.5 / 9)
    const pair = chooseAnimationPair(random)
    for (let preview = 0; preview < 10; preview++) {
      expect(pair.opening).toBe("digital-code")
      expect(pair.ending).toBe("digital-code")
    }
    expect(random).toHaveBeenCalledTimes(1)
    expect(Object.isFrozen(pair)).toBe(true)
    expect(chooseAnimationPair(random).opening).toBe("classic-foliage")
  })
})

describe("launch pair caching", () => {
  test("draws the launch pair once and reuses it for every later read", () => {
    // Regression: the pair was drawn inside App, so an error-boundary reset
    // (which rebuilds App) re-drew it and replayed startup. It is now cached
    // outside the component tree.
    const first = launchAnimationPair()
    expect(Object.isFrozen(first)).toBe(true)
    expect(launchAnimationPair()).toBe(first)
    expect(launchAnimationPair()).toBe(first)
  })
})
