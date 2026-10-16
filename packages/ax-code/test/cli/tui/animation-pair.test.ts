import { describe, expect, test, vi } from "vitest"
import { chooseAnimationPair, launchAnimationPair } from "../../../src/cli/tui/component/animation-pair"

describe("launch animation pairing", () => {
  test.each([
    [[0, 0.02, 1 / 39 - Number.EPSILON], { opening: "digital-code", ending: "digital-code" }],
    [[1 / 39, 1.5 / 39, 2 / 39 - Number.EPSILON], { opening: "classic-foliage", ending: "golden-foliage" }],
    [[2 / 39, 2.5 / 39, 3 / 39 - Number.EPSILON], { opening: "midnight-dream", ending: "sunset-serenade" }],
    [[3 / 39, 3.5 / 39, 4 / 39 - Number.EPSILON], { opening: "fuji-day", ending: "fuji-night" }],
    [[4 / 39, 4.5 / 39, 5 / 39 - Number.EPSILON], { opening: "mahjong-match", ending: "mahjong-ending" }],
    [[5 / 39, 5.5 / 39, 6 / 39 - Number.EPSILON], { opening: "city-night", ending: "city-dawn" }],
    [[6 / 39, 6.5 / 39, 7 / 39 - Number.EPSILON], { opening: "festival-fireworks", ending: "festival-lanterns" }],
    [[7 / 39, 7.5 / 39, 8 / 39 - Number.EPSILON], { opening: "snowfall", ending: "winter-night" }],
    [[8 / 39, 8.5 / 39, 9 / 39 - Number.EPSILON], { opening: "volcano-eruption", ending: "volcano-calm" }],
    [[9 / 39, 9.5 / 39, 10 / 39 - Number.EPSILON], { opening: "bigben-day", ending: "bigben-night" }],
    [[10 / 39, 10.5 / 39, 11 / 39 - Number.EPSILON], { opening: "taipei101-day", ending: "taipei101-neon" }],
    [[11 / 39, 11.5 / 39, 12 / 39 - Number.EPSILON], { opening: "greatwall-dawn", ending: "greatwall-dusk" }],
    [[12 / 39, 12.5 / 39, 13 / 39 - Number.EPSILON], { opening: "torii-day", ending: "torii-night" }],
    [[13 / 39, 13.5 / 39, 14 / 39 - Number.EPSILON], { opening: "taegeuk", ending: "taegeuk" }],
    [[14 / 39, 14.5 / 39, 15 / 39 - Number.EPSILON], { opening: "sagrada-day", ending: "sagrada-night" }],
    [[15 / 39, 15.5 / 39, 16 / 39 - Number.EPSILON], { opening: "corcovado-day", ending: "corcovado-gold" }],
    [[16 / 39, 16.5 / 39, 17 / 39 - Number.EPSILON], { opening: "eiffel-day", ending: "eiffel-night" }],
    [[17 / 39, 17.5 / 39, 18 / 39 - Number.EPSILON], { opening: "brandenburg-night", ending: "brandenburg-dawn" }],
    [[18 / 39, 18.5 / 39, 19 / 39 - Number.EPSILON], { opening: "domes-snow", ending: "domes-clear" }],
    [[19 / 39, 19.5 / 39, 20 / 39 - Number.EPSILON], { opening: "borobudur-mist", ending: "borobudur-noon" }],
    [[20 / 39, 20.5 / 39, 21 / 39 - Number.EPSILON], { opening: "balloons-night", ending: "balloons-dawn" }],
    [[21 / 39, 21.5 / 39, 22 / 39 - Number.EPSILON], { opening: "mekong-dawn", ending: "mekong-dusk" }],
    [[22 / 39, 22.5 / 39, 23 / 39 - Number.EPSILON], { opening: "colosseum-day", ending: "colosseum-night" }],
    [[23 / 39, 23.5 / 39, 24 / 39 - Number.EPSILON], { opening: "space-launch", ending: "space-drift" }],
    [[24 / 39, 24.5 / 39, 25 / 39 - Number.EPSILON], { opening: "dungeon-descent", ending: "dungeon-treasure" }],
    [[25 / 39, 25.5 / 39, 26 / 39 - Number.EPSILON], { opening: "castle-day", ending: "castle-night" }],
    [[26 / 39, 26.5 / 39, 27 / 39 - Number.EPSILON], { opening: "islands-day", ending: "islands-dusk" }],
    [[27 / 39, 27.5 / 39, 28 / 39 - Number.EPSILON], { opening: "jungle-day", ending: "jungle-night" }],
    [[28 / 39, 28.5 / 39, 29 / 39 - Number.EPSILON], { opening: "reef-day", ending: "reef-night" }],
    [[29 / 39, 29.5 / 39, 30 / 39 - Number.EPSILON], { opening: "pyramids-day", ending: "pyramids-night" }],
    [[30 / 39, 30.5 / 39, 31 / 39 - Number.EPSILON], { opening: "aurora-night", ending: "aurora-dawn" }],
    [[31 / 39, 31.5 / 39, 32 / 39 - Number.EPSILON], { opening: "lighthouse-day", ending: "lighthouse-night" }],
    [[32 / 39, 32.5 / 39, 33 / 39 - Number.EPSILON], { opening: "falls-day", ending: "falls-moon" }],
    [[33 / 39, 33.5 / 39, 34 / 39 - Number.EPSILON], { opening: "steppe-day", ending: "steppe-night" }],
    [[34 / 39, 34.5 / 39, 35 / 39 - Number.EPSILON], { opening: "canyon-day", ending: "canyon-night" }],
    [[35 / 39, 35.5 / 39, 36 / 39 - Number.EPSILON], { opening: "singapore-day", ending: "singapore-night" }],
    [[36 / 39, 36.5 / 39, 37 / 39 - Number.EPSILON], { opening: "sanguozhi-muster", ending: "sanguozhi-dusk" }],
    [[37 / 39, 37.5 / 39, 38 / 39 - Number.EPSILON], { opening: "racing-day", ending: "racing-night" }],
    [[38 / 39, 38.5 / 39, 1 - Number.EPSILON], { opening: "dinosaur-day", ending: "dinosaur-night" }],
  ] as [number[], { opening: string; ending: string }][])("draw %s selects %s", (draws, pair) => {
    for (const draw of draws) expect(chooseAnimationPair(() => draw)).toEqual(pair)
  })
  test("reading previews and the ending never draws again or changes the opening", () => {
    const random = vi
      .fn()
      .mockReturnValueOnce(0.02)
      .mockReturnValue(1.5 / 39)
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
