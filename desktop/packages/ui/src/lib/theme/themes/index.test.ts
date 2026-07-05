import { describe, expect, test } from "vitest"
import { getThemeById, themes } from "./index"

describe("theme registry", () => {
  test("contains unique theme ids", () => {
    const ids = themes.map((theme) => theme.metadata.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  test("resolves short-lived app theme aliases", () => {
    expect(getThemeById("app-light")?.metadata.id).toBe("automatosx-light")
    expect(getThemeById("app-dark")?.metadata.id).toBe("automatosx-dark")
  })
})
