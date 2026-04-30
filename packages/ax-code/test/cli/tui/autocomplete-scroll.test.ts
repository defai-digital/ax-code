import { describe, expect, test } from "bun:test"
import {
  autocompleteOptionID,
  autocompleteSelectionScrollDelta,
} from "../../../src/cli/cmd/tui/component/prompt/autocomplete-scroll"

describe("autocomplete scroll", () => {
  test("keeps visible selections stationary", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 4,
        scrollTop: 2,
        viewportHeight: 3,
      }),
    ).toBe(0)
  })

  test("scrolls down by index when the selected child is not rendered yet", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 8,
        scrollTop: 0,
        viewportHeight: 3,
      }),
    ).toBe(6)
  })

  test("scrolls up by index when selection wraps above the viewport", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 0,
        scrollTop: 6,
        viewportHeight: 3,
      }),
    ).toBe(-6)
  })

  test("uses rendered child coordinates when available", () => {
    expect(
      autocompleteSelectionScrollDelta({
        selectedIndex: 8,
        scrollTop: 10,
        viewportHeight: 4,
        targetY: 15,
      }),
    ).toBe(2)
  })

  test("keeps option ids stable", () => {
    expect(autocompleteOptionID(3)).toBe("autocomplete-option-3")
  })
})
