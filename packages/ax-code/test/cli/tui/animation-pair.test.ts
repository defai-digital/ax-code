import { describe, expect, test, vi } from "vitest"
import { chooseAnimationPair } from "../../../src/cli/tui/component/animation-pair"

describe("launch animation pairing", () => {
  test.each([0, 0.1, 0.2 - Number.EPSILON])(
    "draw %s pairs the Digital Code opening with its reverse ending",
    (draw) => {
      expect(chooseAnimationPair(() => draw)).toEqual({ opening: "digital-code", ending: "digital-code" })
    },
  )
  test.each([0.2, 0.3, 0.4 - Number.EPSILON])("draw %s pairs classic foliage with golden foliage", (draw) => {
    expect(chooseAnimationPair(() => draw)).toEqual({ opening: "classic-foliage", ending: "golden-foliage" })
  })
  test.each([0.4, 0.5, 0.6 - Number.EPSILON])("draw %s pairs Midnight Dream with Sunset Serenade", (draw) => {
    expect(chooseAnimationPair(() => draw)).toEqual({ opening: "midnight-dream", ending: "sunset-serenade" })
  })
  test.each([0.6, 0.7, 0.8 - Number.EPSILON])("draw %s pairs daytime Fuji with night Fuji", (draw) => {
    expect(chooseAnimationPair(() => draw)).toEqual({ opening: "fuji-day", ending: "fuji-night" })
  })
  test("reading previews and the ending never draws again or changes the opening", () => {
    const random = vi.fn().mockReturnValueOnce(0.125).mockReturnValue(0.375)
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

test.each([0.8, 0.9, 0.999999])("draw %s pairs Mahjong match with final points", (draw) => {
  expect(chooseAnimationPair(() => draw)).toEqual({ opening: "mahjong-match", ending: "mahjong-ending" })
})
