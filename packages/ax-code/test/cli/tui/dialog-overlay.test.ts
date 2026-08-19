import { describe, expect, test } from "vitest"
import {
  DIALOG_HELP_CHROME_HEIGHT,
  DIALOG_SELECT_CHROME_HEIGHT,
  dialogOverlayMaxHeight,
  dialogOverlayVisibleBodyHeight,
} from "../../../src/cli/cmd/tui/ui/dialog-overlay"

describe("tui dialog overlay viewport", () => {
  test("leaves a one-row margin on each side of the overlay", () => {
    expect(dialogOverlayMaxHeight(24)).toBe(22)
    expect(dialogOverlayMaxHeight(16)).toBe(14)
    expect(dialogOverlayMaxHeight(1)).toBe(1)
  })

  test("sizes the select list from remaining space rather than half the terminal", () => {
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 40,
        terminalHeight: 16,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(4)
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 40,
        terminalHeight: 24,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(12)
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 40,
        terminalHeight: 8,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(1)
  })

  test("does not grow past the content and treats an empty list as empty", () => {
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 3,
        terminalHeight: 24,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(3)
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 0,
        terminalHeight: 24,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(0)
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 0,
        terminalHeight: 24,
        chromeHeight: DIALOG_HELP_CHROME_HEIGHT,
        emptyRows: 1,
      }),
    ).toBe(1)
  })
})
