import { describe, expect, test } from "vitest"
import {
  DIALOG_FRAME_CHROME_HEIGHT,
  DIALOG_HELP_CHROME_HEIGHT,
  DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN,
  DIALOG_OVERLAY_TOP_MARGIN,
  DIALOG_SELECT_CHROME_HEIGHT,
  dialogOverlayBottomMargin,
  dialogOverlayMaxHeight,
  dialogOverlayVisibleBodyHeight,
  dialogOverlayWidth,
} from "../../../src/cli/tui/ui/dialog-overlay"

describe("tui dialog overlay viewport", () => {
  test("keeps the top row and the app's bottom status rows clear", () => {
    // 80x24: the frame must end above the status line at row 22 (0-based).
    expect(dialogOverlayBottomMargin(24)).toBe(2)
    expect(dialogOverlayMaxHeight(24)).toBe(21)
    const lastFrameRow = DIALOG_OVERLAY_TOP_MARGIN + dialogOverlayMaxHeight(24) - 1
    expect(lastFrameRow).toBe(21)
    expect(dialogOverlayMaxHeight(16)).toBe(13)
    // Very short terminals cannot spare both status rows.
    expect(dialogOverlayBottomMargin(10)).toBe(1)
    expect(dialogOverlayMaxHeight(10)).toBe(8)
    expect(dialogOverlayMaxHeight(1)).toBe(1)
  })

  test("clamps the frame width to the terminal minus a side margin", () => {
    expect(dialogOverlayWidth(60, 120)).toBe(60)
    expect(dialogOverlayWidth(80, 80)).toBe(76)
    expect(dialogOverlayWidth(60, 60)).toBe(56)
    // Narrow terminals keep one column per side for label room.
    expect(dialogOverlayWidth(60, 40)).toBe(38)
    expect(dialogOverlayWidth(60, 3)).toBe(1)
  })

  test("sizes the select list from remaining space rather than half the terminal", () => {
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 40,
        terminalHeight: 16,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(2)
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 40,
        terminalHeight: 24,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(10)
    expect(
      dialogOverlayVisibleBodyHeight({
        contentRows: 40,
        terminalHeight: 8,
        chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
      }),
    ).toBe(1)
  })

  test("never grants a body the dialog frame cannot display (silent-clip regression)", () => {
    // For every terminal height and a spread of content sizes, the returned
    // body height plus the picker chrome and the frame chrome must stay within
    // the frame's max height (minus the bottom safe margin). When this was
    // computed without the frame chrome, a list one or two rows taller than
    // the granted space clipped those rows with no scrollbar.
    for (let terminalHeight = 10; terminalHeight <= 80; terminalHeight++) {
      for (const contentRows of [1, 2, 5, 13, 30, 44, 80]) {
        // Degenerate terminals cannot fit even one row of chrome+body; the
        // helper floors at 1 row there and the invariant does not apply.
        const available =
          dialogOverlayMaxHeight(terminalHeight) -
          DIALOG_FRAME_CHROME_HEIGHT -
          DIALOG_SELECT_CHROME_HEIGHT -
          DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN
        if (available < 1) continue
        const body = dialogOverlayVisibleBodyHeight({
          contentRows,
          terminalHeight,
          chromeHeight: DIALOG_SELECT_CHROME_HEIGHT,
        })
        const total =
          body + DIALOG_SELECT_CHROME_HEIGHT + DIALOG_FRAME_CHROME_HEIGHT + DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN
        expect(total).toBeLessThanOrEqual(dialogOverlayMaxHeight(terminalHeight))
        // Overflow signal fidelity: the body equals the content exactly when
        // the frame can display all of it; otherwise it is strictly smaller,
        // which is what turns the scrollbar on.
        if (body === contentRows) {
          expect(
            contentRows + DIALOG_SELECT_CHROME_HEIGHT + DIALOG_FRAME_CHROME_HEIGHT + DIALOG_OVERLAY_BOTTOM_SAFE_MARGIN,
          ).toBeLessThanOrEqual(dialogOverlayMaxHeight(terminalHeight))
        }
      }
    }
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
