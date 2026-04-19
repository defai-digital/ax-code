import { describe, expect, test } from "bun:test"
import { resolveAutocompleteLayout } from "../../../src/cli/cmd/tui/component/prompt/autocomplete-layout"

describe("tui autocomplete layout", () => {
  test("does not render an overlay while autocomplete is hidden", () => {
    expect(
      resolveAutocompleteLayout({
        visible: false,
        anchorX: 10,
        anchorY: 8,
        anchorWidth: 40,
        optionCount: 5,
      }),
    ).toBeUndefined()
  })

  test("positions the overlay from absolute anchor coordinates", () => {
    expect(
      resolveAutocompleteLayout({
        visible: "@",
        anchorX: 12,
        anchorY: 9,
        anchorWidth: 50,
        optionCount: 4,
      }),
    ).toEqual({
      top: 5,
      left: 12,
      width: 50,
      height: 4,
    })
  })

  test("clamps the overlay height to the space above the prompt", () => {
    expect(
      resolveAutocompleteLayout({
        visible: "/",
        anchorX: 3,
        anchorY: 2,
        anchorWidth: 32,
        optionCount: 10,
      }),
    ).toEqual({
      top: 0,
      left: 3,
      width: 32,
      height: 2,
    })
  })
})
