import { describe, expect, test } from "vitest"
import fs from "fs/promises"
import path from "path"

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..")
const APP_SRC = path.join(PACKAGE_ROOT, "src/cli/tui/app.tsx")

// The fatal-error screen is the last-resort UI: its actions must stay reachable
// from the keyboard, not only via mouse clicks on the styled buttons.
describe("fatal error screen keyboard actions", () => {
  test("maps c/r/q/escape keys to the error boundary actions", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const start = app.indexOf("function ErrorComponent(")
    expect(start).toBeGreaterThan(-1)
    // Source can be reformatted by prettier, so collapse whitespace before
    // substring assertions (same approach as the rollback guard assertions).
    const screen = app.slice(start).replace(/\s+/g, " ")

    // ctrl+c still exits; every other modified key is ignored so terminal
    // chords keep their meaning on this screen.
    expect(screen).toContain('if (evt.ctrl && evt.name === "c") { void handleExit() return }')
    expect(screen).toContain("if (evt.ctrl || evt.meta) return")
    expect(screen).toContain('if (evt.name === "c") { copyIssueURL()')
    expect(screen).toContain('} else if (evt.name === "r") { props.reset()')
    expect(screen).toContain('} else if (evt.name === "q" || evt.name === "escape") { void handleExit()')
  })

  test("guards the error boundary exit against double activation", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const start = app.indexOf("function ErrorComponent(")
    expect(start).toBeGreaterThan(-1)
    const screen = app.slice(start).replace(/\s+/g, " ")

    expect(screen).toContain("let exiting = false")
    expect(screen).toContain("if (exiting) return")
    expect(screen).toContain("exiting = true")
  })

  test("prefixes the fatal error screen buttons with their key hints", async () => {
    const app = await fs.readFile(APP_SRC, "utf8")
    const start = app.indexOf("function ErrorComponent(")
    expect(start).toBeGreaterThan(-1)
    const screen = app.slice(start).replace(/\s+/g, " ")

    expect(screen).toContain('`[c] ${uiText("ui.copyIssueUrlExceptionInfoPreFilled")}`')
    expect(screen).toContain('`[r] ${uiText("ui.resetTui")}`')
    expect(screen).toContain('`[q] ${uiText("ui.exit2")}`')
  })
})
