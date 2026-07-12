import { describe, expect, it } from "vitest"

import { getSettingsNavIcon } from "./navIcons"
import { resolveAvailableSettingsSlug, SETTINGS_PAGE_METADATA } from "./metadata"

describe("settings metadata", () => {
  it("exposes every visible settings page with a navigation icon", () => {
    const missingIcons = SETTINGS_PAGE_METADATA.filter((page) => page.slug !== "home").filter(
      (page) => !getSettingsNavIcon(page.slug),
    )

    expect(missingIcons).toEqual([])
  })

  it("disables Remote Instances and hides it from navigation", () => {
    const remoteInstances = SETTINGS_PAGE_METADATA.find((page) => page.slug === "remote-instances")

    expect(remoteInstances?.hideFromNavigation).toBe(true)
    expect(remoteInstances?.isAvailable?.({ isDesktop: true, isWeb: false })).toBe(false)
    expect(resolveAvailableSettingsSlug("remote-instances", { isDesktop: true, isWeb: false })).toBe("home")
  })
})
