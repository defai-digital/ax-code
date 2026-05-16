import { describe, expect, test } from "bun:test"
import {
  dialogSelectClampIndex,
  dialogSelectFlatOptions,
  dialogSelectGroupedOptions,
  dialogSelectMoveIndex,
  dialogSelectRows,
  dialogSelectVisibleHeight,
} from "../../../src/cli/cmd/tui/ui/dialog-select-view-model"

describe("tui dialog select view model", () => {
  const options = [
    { title: "Open Session", value: "session", category: "Navigation" },
    { title: "Change Model", value: "model", category: "Settings" },
    { title: "Disabled", value: "disabled", disabled: true },
  ]

  test("filters disabled options and preserves groups", () => {
    const grouped = dialogSelectGroupedOptions({ options, query: "" })

    expect(grouped).toEqual([
      ["Navigation", [options[0]]],
      ["Settings", [options[1]]],
    ])
    expect(dialogSelectFlatOptions(grouped)).toEqual([options[0], options[1]])
  })

  test("flattens search results when flat mode is enabled", () => {
    const grouped = dialogSelectGroupedOptions({ options, query: "model", flat: true })

    expect(grouped).toEqual([["", [options[1]]]])
  })

  test("does not penalize results with an undefined category", () => {
    const grouped = dialogSelectGroupedOptions({
      options: [
        { title: "Open Session", value: "session", category: "Navigation" },
        { title: "Open Settings", value: "settings", category: undefined },
      ],
      query: "settings",
      flat: true,
    })

    expect(grouped).toEqual([["", [{ title: "Open Settings", value: "settings", category: undefined }]]])
  })

  test("derives row count, visible height, and wrapped movement", () => {
    const grouped = dialogSelectGroupedOptions({ options, query: "" })

    expect(dialogSelectRows(grouped)).toBe(5)
    expect(dialogSelectVisibleHeight(20, 40)).toBe(14)
    expect(dialogSelectVisibleHeight(20, 8)).toBe(1)
    expect(dialogSelectMoveIndex(0, -1, 2)).toBe(1)
    expect(dialogSelectMoveIndex(1, 1, 2)).toBe(0)
    expect(dialogSelectClampIndex(5, 2)).toBe(1)
    expect(dialogSelectClampIndex(-1, 2)).toBe(0)
    expect(dialogSelectClampIndex(5, 0)).toBe(0)
  })
})
