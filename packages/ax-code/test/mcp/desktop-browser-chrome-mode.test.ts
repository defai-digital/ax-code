import { test, expect, vi } from "vitest"
vi.hoisted(() => {
  process.env.AX_CODE_BROWSER_MODE = "chrome"
  process.env.AX_CODE_DESKTOP_BROWSER_TOKEN = "a".repeat(43)
})
import { DesktopBrowser } from "../../src/mcp/desktop-browser"
import { DesktopBrowserRoutes } from "../../src/server/routes/desktop-browser"

test("Chrome-mode workers cannot enroll or expose a Desktop provider even with an inherited token", async () => {
  expect(DesktopBrowser.enabled()).toBe(false)
  expect(DesktopBrowser.hostAuthorized("a".repeat(43))).toBe(false)
  const response = await DesktopBrowserRoutes().request("/capability", {
    headers: { [DesktopBrowser.HEADER]: "a".repeat(43) },
  })
  expect(response.status).toBe(403)
})
