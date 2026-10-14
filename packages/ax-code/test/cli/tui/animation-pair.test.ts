import { describe, expect, test, vi } from "vitest"
import { chooseAnimationPair, launchAnimationPair } from "../../../src/cli/tui/component/animation-pair"

describe("launch animation pairing", () => {
  test.each([
    [[0, 0.02, 1 / 37 - Number.EPSILON], { opening: "digital-code", ending: "digital-code" }],
    [[1 / 37, 1.5 / 37, 2 / 37 - Number.EPSILON], { opening: "classic-foliage", ending: "golden-foliage" }],
    [[2 / 37, 2.5 / 37, 3 / 37 - Number.EPSILON], { opening: "midnight-dream", ending: "sunset-serenade" }],
    [[3 / 37, 3.5 / 37, 4 / 37 - Number.EPSILON], { opening: "fuji-day", ending: "fuji-night" }],
    [[4 / 37, 4.5 / 37, 5 / 37 - Number.EPSILON], { opening: "mahjong-match", ending: "mahjong-ending" }],
    [[5 / 37, 5.5 / 37, 6 / 37 - Number.EPSILON], { opening: "city-night", ending: "city-dawn" }],
    [[6 / 37, 6.5 / 37, 7 / 37 - Number.EPSILON], { opening: "festival-fireworks", ending: "festival-lanterns" }],
    [[7 / 37, 7.5 / 37, 8 / 37 - Number.EPSILON], { opening: "snowfall", ending: "winter-night" }],
    [[8 / 37, 8.5 / 37, 9 / 37 - Number.EPSILON], { opening: "volcano-eruption", ending: "volcano-calm" }],
    [[9 / 37, 9.5 / 37, 10 / 37 - Number.EPSILON], { opening: "bigben-day", ending: "bigben-night" }],
    [[10 / 37, 10.5 / 37, 11 / 37 - Number.EPSILON], { opening: "taipei101-day", ending: "taipei101-neon" }],
    [[11 / 37, 11.5 / 37, 12 / 37 - Number.EPSILON], { opening: "greatwall-dawn", ending: "greatwall-dusk" }],
    [[12 / 37, 12.5 / 37, 13 / 37 - Number.EPSILON], { opening: "torii-day", ending: "torii-night" }],
    [[13 / 37, 13.5 / 37, 14 / 37 - Number.EPSILON], { opening: "taegeuk", ending: "taegeuk" }],
    [[14 / 37, 14.5 / 37, 15 / 37 - Number.EPSILON], { opening: "sagrada-day", ending: "sagrada-night" }],
    [[15 / 37, 15.5 / 37, 16 / 37 - Number.EPSILON], { opening: "corcovado-day", ending: "corcovado-gold" }],
    [[16 / 37, 16.5 / 37, 17 / 37 - Number.EPSILON], { opening: "eiffel-day", ending: "eiffel-night" }],
    [[17 / 37, 17.5 / 37, 18 / 37 - Number.EPSILON], { opening: "brandenburg-night", ending: "brandenburg-dawn" }],
    [[18 / 37, 18.5 / 37, 19 / 37 - Number.EPSILON], { opening: "domes-snow", ending: "domes-clear" }],
    [[19 / 37, 19.5 / 37, 20 / 37 - Number.EPSILON], { opening: "borobudur-mist", ending: "borobudur-noon" }],
    [[20 / 37, 20.5 / 37, 21 / 37 - Number.EPSILON], { opening: "balloons-night", ending: "balloons-dawn" }],
    [[21 / 37, 21.5 / 37, 22 / 37 - Number.EPSILON], { opening: "mekong-dawn", ending: "mekong-dusk" }],
    [[22 / 37, 22.5 / 37, 23 / 37 - Number.EPSILON], { opening: "colosseum-day", ending: "colosseum-night" }],
    [[23 / 37, 23.5 / 37, 24 / 37 - Number.EPSILON], { opening: "space-launch", ending: "space-drift" }],
    [[24 / 37, 24.5 / 37, 25 / 37 - Number.EPSILON], { opening: "dungeon-descent", ending: "dungeon-treasure" }],
    [[25 / 37, 25.5 / 37, 26 / 37 - Number.EPSILON], { opening: "castle-day", ending: "castle-night" }],
    [[26 / 37, 26.5 / 37, 27 / 37 - Number.EPSILON], { opening: "islands-day", ending: "islands-dusk" }],
    [[27 / 37, 27.5 / 37, 28 / 37 - Number.EPSILON], { opening: "jungle-day", ending: "jungle-night" }],
    [[28 / 37, 28.5 / 37, 29 / 37 - Number.EPSILON], { opening: "reef-day", ending: "reef-night" }],
    [[29 / 37, 29.5 / 37, 30 / 37 - Number.EPSILON], { opening: "pyramids-day", ending: "pyramids-night" }],
    [[30 / 37, 30.5 / 37, 31 / 37 - Number.EPSILON], { opening: "aurora-night", ending: "aurora-dawn" }],
    [[31 / 37, 31.5 / 37, 32 / 37 - Number.EPSILON], { opening: "lighthouse-day", ending: "lighthouse-night" }],
    [[32 / 37, 32.5 / 37, 33 / 37 - Number.EPSILON], { opening: "falls-day", ending: "falls-moon" }],
    [[33 / 37, 33.5 / 37, 34 / 37 - Number.EPSILON], { opening: "steppe-day", ending: "steppe-night" }],
    [[34 / 37, 34.5 / 37, 35 / 37 - Number.EPSILON], { opening: "canyon-day", ending: "canyon-night" }],
    [[35 / 37, 35.5 / 37, 36 / 37 - Number.EPSILON], { opening: "singapore-day", ending: "singapore-night" }],
    [[36 / 37, 36.5 / 37, 1 - Number.EPSILON], { opening: "sanguozhi-muster", ending: "sanguozhi-dusk" }],
  ] as [number[], { opening: string; ending: string }][])("draw %s selects %s", (draws, pair) => {
    for (const draw of draws) expect(chooseAnimationPair(() => draw)).toEqual(pair)
  })
  test("reading previews and the ending never draws again or changes the opening", () => {
    const random = vi
      .fn()
      .mockReturnValueOnce(0.02)
      .mockReturnValue(1.5 / 37)
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
