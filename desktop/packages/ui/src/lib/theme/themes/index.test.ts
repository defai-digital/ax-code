import { describe, expect, test } from "vitest"
import { DEFAULT_LIGHT_THEME_ID, getThemeById, themes } from "./index"

describe("theme registry", () => {
  test("contains unique theme ids", () => {
    const ids = themes.map((theme) => theme.metadata.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  test("resolves short-lived app theme aliases", () => {
    expect(getThemeById("app-light")?.metadata.id).toBe("automatosx-light")
    expect(getThemeById("app-dark")?.metadata.id).toBe("automatosx-dark")
  })

  test("default light theme has a distinct elevated surface ladder", () => {
    const light = getThemeById(DEFAULT_LIGHT_THEME_ID)
    expect(light).toBeDefined()
    expect(light?.colors.surface.elevated).not.toBe(light?.colors.surface.background)
    expect(light?.colors.surface.muted).not.toBe(light?.colors.surface.background)
    expect(light?.colors.surface.subtle).not.toBe(light?.colors.surface.elevated)
  })
})
