import { describe, expect, test } from "bun:test"
import {
  autocompleteOptionID,
  autocompletePopupPlacement,
  autocompleteSelectionScrollDelta,
} from "../../../src/cli/cmd/tui/component/prompt/autocomplete-scroll"

describe("autocomplete scroll", () => {
  test("keeps visible selections stationary", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 4,
        viewportY: 20,
        viewportHeight: 3,
        scrollOffset: 2,
      }),
    ).toBe(0)
  })

  test("scrolls down by index when the selected child is not rendered yet", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 8,
        viewportY: 20,
        viewportHeight: 3,
        scrollOffset: 0,
      }),
    ).toBe(6)
  })

  test("scrolls up by index when selection wraps above the viewport", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 0,
        viewportY: 20,
        viewportHeight: 3,
        scrollOffset: 6,
      }),
    ).toBe(-6)
  })

  test("uses rendered child coordinates when available", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 8,
        viewportY: 10,
        viewportHeight: 4,
        targetY: 15,
      }),
    ).toBe(2)
  })

  test("keeps option ids stable", () => {
    expect(autocompleteOptionID(3)).toBe("autocomplete-option-3")
  })

  test("opens above a bottom prompt even when local parent space is shallow", () => {
    expect(
      autocompletePopupPlacement({
        desiredHeight: 10,
        anchorLocalY: 0,
        anchorGlobalY: 36,
        anchorHeight: 4,
        terminalHeight: 42,
      }),
    ).toEqual({ direction: "above", height: 10, top: -10 })
  })

  test("opens below when the prompt is near the top of the terminal", () => {
    expect(
      autocompletePopupPlacement({
        desiredHeight: 10,
        anchorLocalY: 0,
        anchorGlobalY: 1,
        anchorHeight: 3,
        terminalHeight: 42,
      }),
    ).toEqual({ direction: "below", height: 10, top: 3 })
  })
})
