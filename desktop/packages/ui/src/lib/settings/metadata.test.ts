import { describe, expect, it } from "vitest"

import { getSettingsNavIcon } from "./navIcons"
import { SETTINGS_PAGE_METADATA, getSettingsPageMeta, resolveSettingsSlug } from "./metadata"

describe("settings metadata", () => {
  it("exposes every visible settings page with a navigation icon", () => {
    const missingIcons = SETTINGS_PAGE_METADATA.filter((page) => page.slug !== "home").filter(
      (page) => !getSettingsNavIcon(page.slug),
    )

    expect(missingIcons).toEqual([])
  })

  it("makes About available in the desktop runtime only", () => {
    const about = getSettingsPageMeta("about")

    expect(about?.isAvailable?.({ isDesktop: true, isWeb: false })).toBe(true)
    expect(about?.isAvailable?.({ isDesktop: false, isWeb: true })).toBe(false)
    expect(resolveSettingsSlug("about")).toBe("about")
  })
})
