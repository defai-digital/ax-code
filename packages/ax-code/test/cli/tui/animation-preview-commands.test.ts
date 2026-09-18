import { describe, expect, test } from "vitest"
import { animationPreviewCommands } from "../../../src/cli/tui/component/animation-preview-commands"
import { dialogSelectFilteredOptions } from "../../../src/cli/tui/ui/dialog-select-view-model"
import { translate, LOCALES } from "../../../src/cli/tui/i18n"
import type { DialogContext } from "../../../src/cli/tui/ui/dialog"

describe("animation command palette", () => {
  test.each(LOCALES)("all five themes are searchable and actionable in %s", (locale) => {
    const calls: string[] = []
    const options = animationPreviewCommands({
      t: (key, values) => translate(locale, key, values),
      opening: (style) => {
        calls.push(`opening:${style}`)
      },
      ending: (style) => {
        calls.push(`ending:${style}`)
      },
    })
    expect(options).toHaveLength(10)
    expect(new Set(options.map((option) => option.value)).size).toBe(10)
    expect(new Set(options.map((option) => option.slash!.name)).size).toBe(10)
    expect(options.every((option) => option.slash?.hidden === true)).toBe(true)
    for (const family of ["Digital Code", "Foliage", "Bench", "Fuji Mountain", "Mahjong"]) {
      const found = dialogSelectFilteredOptions(options, family)
      for (const option of options.filter((item) => item.category!.endsWith(family))) expect(found).toContain(option)
    }
    const dialog = {
      clear: () => {
        calls.push("clear")
      },
    } as unknown as DialogContext
    for (const option of options) option.onSelect!(dialog)
    expect(calls).toEqual([
      "clear",
      "opening:digital-code",
      "clear",
      "ending:digital-code",
      "clear",
      "opening:classic-foliage",
      "clear",
      "ending:golden-foliage",
      "clear",
      "opening:midnight-dream",
      "clear",
      "ending:sunset-serenade",
      "clear",
      "opening:fuji-day",
      "clear",
      "ending:fuji-night",
      "clear",
      "opening:mahjong-match",
      "clear",
      "ending:mahjong-ending",
    ])
  })
})
