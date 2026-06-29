import { createRequire } from "node:module"
import { describe, expect, test } from "vitest"

const require = createRequire(import.meta.url)
const { MAX_DESKTOP_WINDOW_TITLE_LENGTH, sanitizeDesktopWindowTitle } = require("./desktop-window-title.js")

describe("desktop window title policy", () => {
  test("trims and collapses control characters before setting the native title", () => {
    expect(sanitizeDesktopWindowTitle("  Remote\n\tProject\u0000AX Code  ")).toBe("Remote Project AX Code")
  })

  test("caps native title length from renderer IPC", () => {
    const title = sanitizeDesktopWindowTitle("x".repeat(MAX_DESKTOP_WINDOW_TITLE_LENGTH + 20))

    expect(title).toHaveLength(MAX_DESKTOP_WINDOW_TITLE_LENGTH)
  })

  test("rejects non-string titles", () => {
    expect(sanitizeDesktopWindowTitle(null)).toBe("")
    expect(sanitizeDesktopWindowTitle({ title: "AX Code" })).toBe("")
  })
})
