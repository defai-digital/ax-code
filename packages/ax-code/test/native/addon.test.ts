import { describe, expect, test } from "vitest"
import { formatNativeAddonLoadError } from "../../src/native/addon"

describe("native addon loading", () => {
  test("formats unprintable load failures safely", () => {
    const error = {
      toString() {
        throw new Error("cannot stringify")
      },
    }

    expect(formatNativeAddonLoadError(error)).toBe("Unknown error")
  })
})
