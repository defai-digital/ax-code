import { describe, expect, test } from "vitest"
import { MediaProjection } from "../../src/session/media-projection"

describe("MediaProjection", () => {
  test("degraded mode keeps only the newest bounded occurrences", () => {
    const selector = MediaProjection.create({ mode: "degraded", total: 5, keepRecent: 2 })
    expect(Array.from({ length: 5 }, () => selector.keep())).toEqual([false, false, false, true, true])
    expect(selector.omitted).toBe(3)
  })

  test("normal keeps all media and stripped omits all media", () => {
    const normal = MediaProjection.create({ mode: "normal", total: 3 })
    const stripped = MediaProjection.create({ mode: "stripped", total: 3 })
    expect(Array.from({ length: 3 }, () => normal.keep())).toEqual([true, true, true])
    expect(Array.from({ length: 3 }, () => stripped.keep())).toEqual([false, false, false])
  })

  test("recovery ladder advances at most once per rung", () => {
    expect(MediaProjection.next("normal")).toBe("degraded")
    expect(MediaProjection.next("degraded")).toBe("stripped")
    expect(MediaProjection.next("stripped")).toBeUndefined()
  })
})
