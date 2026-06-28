import { readFile } from "node:fs/promises"
import path from "node:path"
import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { shouldCheckForUpdatesOnStartup } = require("./startup-update-policy.js")

describe("startup update policy", () => {
  test("allows startup update checks unless release smoke disables them", () => {
    expect(shouldCheckForUpdatesOnStartup({})).toBe(true)
    expect(shouldCheckForUpdatesOnStartup({ AX_CODE_DESKTOP_DISABLE_AUTO_UPDATE: "0" })).toBe(true)
    expect(shouldCheckForUpdatesOnStartup({ AX_CODE_DESKTOP_DISABLE_AUTO_UPDATE: "1" })).toBe(false)
  })

  test("packaged smoke disables startup auto-update checks", async () => {
    const smokeScript = await readFile(path.join(import.meta.dirname, "../scripts/smoke-packaged-app.mjs"), "utf8")

    expect(smokeScript).toContain('AX_CODE_DESKTOP_DISABLE_AUTO_UPDATE: "1"')
  })
})
