import { describe, expect, test } from "vitest"
import { sidebarRestoreEntry, sidebarRestoreVisible } from "../../../src/cli/tui/sidebar-restore-view-model"

describe("sidebar restore chrome", () => {
  test("hides on home, child sessions, and the auto-wide panel", () => {
    expect(
      sidebarRestoreVisible({ sessionRoute: false, childSession: false, sidebar: "auto", terminalWidth: 80 }),
    ).toBe(false)
    expect(sidebarRestoreVisible({ sessionRoute: true, childSession: true, sidebar: "hide", terminalWidth: 200 })).toBe(
      false,
    )
    expect(
      sidebarRestoreVisible({ sessionRoute: true, childSession: false, sidebar: "auto", terminalWidth: 200 }),
    ).toBe(false)
  })

  test("shows when the session sidebar is collapsed or too narrow to dock", () => {
    expect(
      sidebarRestoreVisible({ sessionRoute: true, childSession: false, sidebar: "hide", terminalWidth: 200 }),
    ).toBe(true)
    expect(
      sidebarRestoreVisible({ sessionRoute: true, childSession: false, sidebar: "auto", terminalWidth: 120 }),
    ).toBe(true)
  })

  test("keeps a clickable /sidebar label except on extremely narrow chrome", () => {
    expect(sidebarRestoreEntry(80)).toBe("/sidebar")
    expect(sidebarRestoreEntry(12)).toBe("/sidebar")
    expect(sidebarRestoreEntry(11)).toBe("")
  })
})
