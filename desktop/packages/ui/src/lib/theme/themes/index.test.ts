import { describe, expect, test } from "vitest"
import { CSSVariableGenerator } from "@/lib/theme/cssGenerator"
import { DEFAULT_DARK_THEME_ID, DEFAULT_LIGHT_THEME_ID, getThemeById, themes } from "./index"

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

  test("default product themes document Plex Sans for UI, not mono-as-sans", () => {
    for (const id of [DEFAULT_LIGHT_THEME_ID, DEFAULT_DARK_THEME_ID]) {
      const theme = getThemeById(id)
      expect(theme?.config?.fonts?.sans).toMatch(/IBM Plex Sans/)
      expect(theme?.config?.fonts?.heading).toMatch(/IBM Plex Sans/)
      expect(theme?.config?.fonts?.mono).toMatch(/IBM Plex Mono/)
    }
  })

  test("theme CSS generation does not override UI/code font variables", () => {
    const theme = getThemeById(DEFAULT_DARK_THEME_ID)
    expect(theme).toBeDefined()
    const css = new CSSVariableGenerator().generate(theme!)
    expect(css).not.toMatch(/--font-sans\s*:/)
    expect(css).not.toMatch(/--font-mono\s*:/)
    expect(css).not.toMatch(/--font-heading\s*:/)
  })

  test("Ink calm themes register as a light/dark pair with distinct surface ladders", () => {
    const dark = getThemeById("ink-dark")
    const light = getThemeById("ink-light")

    expect(dark?.metadata.name).toBe("Ink")
    expect(light?.metadata.name).toBe("Ink")
    expect(dark?.metadata.variant).toBe("dark")
    expect(light?.metadata.variant).toBe("light")
    expect(dark?.metadata.tags).toEqual(expect.arrayContaining(["japanese", "calm", "ma"]))
    expect(light?.metadata.tags).toEqual(expect.arrayContaining(["japanese", "calm", "ma"]))

    for (const theme of [dark, light]) {
      expect(theme).toBeDefined()
      expect(theme!.colors.surface.elevated).not.toBe(theme!.colors.surface.background)
      expect(theme!.colors.surface.muted).not.toBe(theme!.colors.surface.background)
      expect(theme!.colors.status.error).not.toBe(theme!.colors.primary.base)
      expect(theme!.config?.fonts?.sans).toMatch(/IBM Plex Sans/)
      expect(theme!.config?.fonts?.mono).toMatch(/IBM Plex Mono/)
    }

    const darkCss = new CSSVariableGenerator().generate(dark!)
    const lightCss = new CSSVariableGenerator().generate(light!)
    expect(darkCss).toContain("--background:")
    expect(lightCss).toContain("--background:")
    expect(darkCss).toContain(dark!.colors.primary.base)
    expect(lightCss).toContain(light!.colors.primary.base)
  })
})
