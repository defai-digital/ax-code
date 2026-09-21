import { describe, expect, test } from "vitest"
import { contextMenuAvailability, contextMenuPlacement } from "../../../src/cli/tui/ui/context-menu-model"

describe("context menu availability", () => {
  test("does not open when neither copy nor paste applies", () => {
    expect(contextMenuAvailability({ hasSelection: false, hasEditor: false })).toBeNull()
  })
  test("always offers both actions, disabling the unavailable one", () => {
    expect(contextMenuAvailability({ hasSelection: true, hasEditor: false })).toEqual({ copy: true, paste: false })
    expect(contextMenuAvailability({ hasSelection: false, hasEditor: true })).toEqual({ copy: false, paste: true })
    expect(contextMenuAvailability({ hasSelection: true, hasEditor: true })).toEqual({ copy: true, paste: true })
  })
})

describe("context menu placement", () => {
  test("opens at the click cell when it fits", () => {
    expect(contextMenuPlacement({ x: 10, y: 5, width: 12, height: 4, termWidth: 80, termHeight: 24 })).toEqual({
      left: 10,
      top: 5,
    })
  })
  test("clamps to the right and bottom edges", () => {
    expect(contextMenuPlacement({ x: 78, y: 22, width: 12, height: 4, termWidth: 80, termHeight: 24 })).toEqual({
      left: 68,
      top: 20,
    })
  })
  test("never goes negative on tiny terminals", () => {
    expect(contextMenuPlacement({ x: 2, y: 1, width: 12, height: 4, termWidth: 10, termHeight: 3 })).toEqual({
      left: 0,
      top: 0,
    })
  })
})
