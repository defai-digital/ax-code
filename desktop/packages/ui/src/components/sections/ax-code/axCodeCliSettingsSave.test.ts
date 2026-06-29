import { describe, expect, test, vi } from "vitest"

import { saveAxCodeCliSettings } from "./axCodeCliSettingsSave"

describe("saveAxCodeCliSettings", () => {
  test("trims and saves the configured binary path before reloading AX Code", async () => {
    const updateDesktopSettings = vi.fn(async () => undefined)
    const reloadAxCodeConfiguration = vi.fn(async () => undefined)

    const result = await saveAxCodeCliSettings({
      binaryPath: "  /opt/homebrew/bin/ax-code  ",
      reloadMessage: "Restarting AX Code...",
      updateDesktopSettings,
      reloadAxCodeConfiguration,
    })

    expect(result).toEqual({ status: "saved" })
    expect(updateDesktopSettings).toHaveBeenCalledWith({ axCodeBinary: "/opt/homebrew/bin/ax-code" })
    expect(reloadAxCodeConfiguration).toHaveBeenCalledWith({
      message: "Restarting AX Code...",
      mode: "projects",
      scopes: ["all"],
    })
  })

  test("reports reload failures without rejecting the click handler", async () => {
    const error = new Error("reload timed out")

    const result = await saveAxCodeCliSettings({
      binaryPath: "/usr/local/bin/ax-code",
      reloadMessage: "Restarting AX Code...",
      updateDesktopSettings: vi.fn(async () => undefined),
      reloadAxCodeConfiguration: vi.fn(async () => {
        throw error
      }),
    })

    expect(result).toEqual({ status: "failed", error })
  })
})
