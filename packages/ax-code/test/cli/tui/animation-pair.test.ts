import { describe, expect, test, vi } from "vitest"
import { chooseAnimationPair, launchAnimationPair } from "../../../src/cli/tui/component/animation-pair"

describe("launch animation pairing", () => {
  test.each([
    [[0, 0.02, 1 / 36 - Number.EPSILON], { opening: "digital-code", ending: "digital-code" }],
    [[1 / 36, 1.5 / 36, 2 / 36 - Number.EPSILON], { opening: "classic-foliage", ending: "golden-foliage" }],
    [[2 / 36, 2.5 / 36, 3 / 36 - Number.EPSILON], { opening: "midnight-dream", ending: "sunset-serenade" }],
    [[3 / 36, 3.5 / 36, 4 / 36 - Number.EPSILON], { opening: "fuji-day", ending: "fuji-night" }],
    [[4 / 36, 4.5 / 36, 5 / 36 - Number.EPSILON], { opening: "mahjong-match", ending: "mahjong-ending" }],
    [[5 / 36, 5.5 / 36, 6 / 36 - Number.EPSILON], { opening: "city-night", ending: "city-dawn" }],
    [[6 / 36, 6.5 / 36, 7 / 36 - Number.EPSILON], { opening: "festival-fireworks", ending: "festival-lanterns" }],
    [[7 / 36, 7.5 / 36, 8 / 36 - Number.EPSILON], { opening: "snowfall", ending: "winter-night" }],
    [[8 / 36, 8.5 / 36, 9 / 36 - Number.EPSILON], { opening: "volcano-eruption", ending: "volcano-calm" }],
    [[9 / 36, 9.5 / 36, 10 / 36 - Number.EPSILON], { opening: "bigben-day", ending: "bigben-night" }],
    [[10 / 36, 10.5 / 36, 11 / 36 - Number.EPSILON], { opening: "taipei101-day", ending: "taipei101-neon" }],
    [[11 / 36, 11.5 / 36, 12 / 36 - Number.EPSILON], { opening: "greatwall-dawn", ending: "greatwall-dusk" }],
    [[12 / 36, 12.5 / 36, 13 / 36 - Number.EPSILON], { opening: "torii-day", ending: "torii-night" }],
    [[13 / 36, 13.5 / 36, 14 / 36 - Number.EPSILON], { opening: "taegeuk", ending: "taegeuk" }],
    [[14 / 36, 14.5 / 36, 15 / 36 - Number.EPSILON], { opening: "sagrada-day", ending: "sagrada-night" }],
    [[15 / 36, 15.5 / 36, 16 / 36 - Number.EPSILON], { opening: "corcovado-day", ending: "corcovado-gold" }],
    [[16 / 36, 16.5 / 36, 17 / 36 - Number.EPSILON], { opening: "eiffel-day", ending: "eiffel-night" }],
    [[17 / 36, 17.5 / 36, 18 / 36 - Number.EPSILON], { opening: "brandenburg-night", ending: "brandenburg-dawn" }],
    [[18 / 36, 18.5 / 36, 19 / 36 - Number.EPSILON], { opening: "domes-snow", ending: "domes-clear" }],
    [[19 / 36, 19.5 / 36, 20 / 36 - Number.EPSILON], { opening: "borobudur-mist", ending: "borobudur-noon" }],
    [[20 / 36, 20.5 / 36, 21 / 36 - Number.EPSILON], { opening: "balloons-night", ending: "balloons-dawn" }],
    [[21 / 36, 21.5 / 36, 22 / 36 - Number.EPSILON], { opening: "mekong-dawn", ending: "mekong-dusk" }],
    [[22 / 36, 22.5 / 36, 23 / 36 - Number.EPSILON], { opening: "colosseum-day", ending: "colosseum-night" }],
    [[23 / 36, 23.5 / 36, 24 / 36 - Number.EPSILON], { opening: "space-launch", ending: "space-drift" }],
    [[24 / 36, 24.5 / 36, 25 / 36 - Number.EPSILON], { opening: "dungeon-descent", ending: "dungeon-treasure" }],
    [[25 / 36, 25.5 / 36, 26 / 36 - Number.EPSILON], { opening: "castle-day", ending: "castle-night" }],
    [[26 / 36, 26.5 / 36, 27 / 36 - Number.EPSILON], { opening: "islands-day", ending: "islands-dusk" }],
    [[27 / 36, 27.5 / 36, 28 / 36 - Number.EPSILON], { opening: "jungle-day", ending: "jungle-night" }],
    [[28 / 36, 28.5 / 36, 29 / 36 - Number.EPSILON], { opening: "reef-day", ending: "reef-night" }],
    [[29 / 36, 29.5 / 36, 30 / 36 - Number.EPSILON], { opening: "pyramids-day", ending: "pyramids-night" }],
    [[30 / 36, 30.5 / 36, 31 / 36 - Number.EPSILON], { opening: "aurora-night", ending: "aurora-dawn" }],
    [[31 / 36, 31.5 / 36, 32 / 36 - Number.EPSILON], { opening: "lighthouse-day", ending: "lighthouse-night" }],
    [[32 / 36, 32.5 / 36, 33 / 36 - Number.EPSILON], { opening: "falls-day", ending: "falls-moon" }],
    [[33 / 36, 33.5 / 36, 34 / 36 - Number.EPSILON], { opening: "steppe-day", ending: "steppe-night" }],
    [[34 / 36, 34.5 / 36, 35 / 36 - Number.EPSILON], { opening: "canyon-day", ending: "canyon-night" }],
    [[35 / 36, 35.5 / 36, 1 - Number.EPSILON], { opening: "singapore-day", ending: "singapore-night" }],
  ] as [number[], { opening: string; ending: string }][])("draw %s selects %s", (draws, pair) => {
    for (const draw of draws) expect(chooseAnimationPair(() => draw)).toEqual(pair)
  })
  test("reading previews and the ending never draws again or changes the opening", () => {
    const random = vi
      .fn()
      .mockReturnValueOnce(0.02)
      .mockReturnValue(1.5 / 36)
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
