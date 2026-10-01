import { describe, expect, test, vi } from "vitest"
import { chooseAnimationPair, launchAnimationPair } from "../../../src/cli/tui/component/animation-pair"

describe("launch animation pairing", () => {
  test.each([
    [[0, 0.02, 1 / 35 - Number.EPSILON], { opening: "digital-code", ending: "digital-code" }],
    [[1 / 35, 1.5 / 35, 2 / 35 - Number.EPSILON], { opening: "classic-foliage", ending: "golden-foliage" }],
    [[2 / 35, 2.5 / 35, 3 / 35 - Number.EPSILON], { opening: "midnight-dream", ending: "sunset-serenade" }],
    [[3 / 35, 3.5 / 35, 4 / 35 - Number.EPSILON], { opening: "fuji-day", ending: "fuji-night" }],
    [[4 / 35, 4.5 / 35, 5 / 35 - Number.EPSILON], { opening: "mahjong-match", ending: "mahjong-ending" }],
    [[5 / 35, 5.5 / 35, 6 / 35 - Number.EPSILON], { opening: "city-night", ending: "city-dawn" }],
    [[6 / 35, 6.5 / 35, 7 / 35 - Number.EPSILON], { opening: "festival-fireworks", ending: "festival-lanterns" }],
    [[7 / 35, 7.5 / 35, 8 / 35 - Number.EPSILON], { opening: "snowfall", ending: "winter-night" }],
    [[8 / 35, 8.5 / 35, 9 / 35 - Number.EPSILON], { opening: "volcano-eruption", ending: "volcano-calm" }],
    [[9 / 35, 9.5 / 35, 10 / 35 - Number.EPSILON], { opening: "bigben-day", ending: "bigben-night" }],
    [[10 / 35, 10.5 / 35, 11 / 35 - Number.EPSILON], { opening: "taipei101-day", ending: "taipei101-neon" }],
    [[11 / 35, 11.5 / 35, 12 / 35 - Number.EPSILON], { opening: "greatwall-dawn", ending: "greatwall-dusk" }],
    [[12 / 35, 12.5 / 35, 13 / 35 - Number.EPSILON], { opening: "torii-day", ending: "torii-night" }],
    [[13 / 35, 13.5 / 35, 14 / 35 - Number.EPSILON], { opening: "taegeuk", ending: "taegeuk" }],
    [[14 / 35, 14.5 / 35, 15 / 35 - Number.EPSILON], { opening: "sagrada-day", ending: "sagrada-night" }],
    [[15 / 35, 15.5 / 35, 16 / 35 - Number.EPSILON], { opening: "corcovado-day", ending: "corcovado-gold" }],
    [[16 / 35, 16.5 / 35, 17 / 35 - Number.EPSILON], { opening: "eiffel-day", ending: "eiffel-night" }],
    [[17 / 35, 17.5 / 35, 18 / 35 - Number.EPSILON], { opening: "brandenburg-night", ending: "brandenburg-dawn" }],
    [[18 / 35, 18.5 / 35, 19 / 35 - Number.EPSILON], { opening: "domes-snow", ending: "domes-clear" }],
    [[19 / 35, 19.5 / 35, 20 / 35 - Number.EPSILON], { opening: "borobudur-mist", ending: "borobudur-noon" }],
    [[20 / 35, 20.5 / 35, 21 / 35 - Number.EPSILON], { opening: "balloons-night", ending: "balloons-dawn" }],
    [[21 / 35, 21.5 / 35, 22 / 35 - Number.EPSILON], { opening: "mekong-dawn", ending: "mekong-dusk" }],
    [[22 / 35, 22.5 / 35, 23 / 35 - Number.EPSILON], { opening: "colosseum-day", ending: "colosseum-night" }],
    [[23 / 35, 23.5 / 35, 24 / 35 - Number.EPSILON], { opening: "space-launch", ending: "space-drift" }],
    [[24 / 35, 24.5 / 35, 25 / 35 - Number.EPSILON], { opening: "dungeon-descent", ending: "dungeon-treasure" }],
    [[25 / 35, 25.5 / 35, 26 / 35 - Number.EPSILON], { opening: "castle-day", ending: "castle-night" }],
    [[26 / 35, 26.5 / 35, 27 / 35 - Number.EPSILON], { opening: "islands-day", ending: "islands-dusk" }],
    [[27 / 35, 27.5 / 35, 28 / 35 - Number.EPSILON], { opening: "jungle-day", ending: "jungle-night" }],
    [[28 / 35, 28.5 / 35, 29 / 35 - Number.EPSILON], { opening: "reef-day", ending: "reef-night" }],
    [[29 / 35, 29.5 / 35, 30 / 35 - Number.EPSILON], { opening: "pyramids-day", ending: "pyramids-night" }],
    [[30 / 35, 30.5 / 35, 31 / 35 - Number.EPSILON], { opening: "aurora-night", ending: "aurora-dawn" }],
    [[31 / 35, 31.5 / 35, 32 / 35 - Number.EPSILON], { opening: "lighthouse-day", ending: "lighthouse-night" }],
    [[32 / 35, 32.5 / 35, 33 / 35 - Number.EPSILON], { opening: "falls-day", ending: "falls-moon" }],
    [[33 / 35, 33.5 / 35, 34 / 35 - Number.EPSILON], { opening: "steppe-day", ending: "steppe-night" }],
    [[34 / 35, 34.5 / 35, 1 - Number.EPSILON], { opening: "canyon-day", ending: "canyon-night" }],
  ] as [number[], { opening: string; ending: string }][])("draw %s selects %s", (draws, pair) => {
    for (const draw of draws) expect(chooseAnimationPair(() => draw)).toEqual(pair)
  })
  test("reading previews and the ending never draws again or changes the opening", () => {
    const random = vi
      .fn()
      .mockReturnValueOnce(0.02)
      .mockReturnValue(1.5 / 35)
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
