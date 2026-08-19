import { describe, expect, test } from "vitest"
import {
  dialogSelectActionOption,
  dialogSelectClampIndex,
  dialogSelectFlatOptions,
  dialogSelectGroupStartIndex,
  dialogSelectGroupedOptions,
  dialogSelectHasCurrentValue,
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

  test("preserves disabled options and groups", () => {
    const grouped = dialogSelectGroupedOptions({ options, query: "" })

    expect(grouped).toEqual([
      ["Navigation", [options[0]]],
      ["Settings", [options[1]]],
      ["", [options[2]]],
    ])
    expect(dialogSelectFlatOptions(grouped)).toEqual(options)
  })

  test("indexes rows by group offset so duplicate values stay distinct", () => {
    const grouped: [string, { value: string }[]][] = [
      ["Recent", [{ value: "opus" }]],
      ["Anthropic", [{ value: "opus" }, { value: "sonnet" }]],
    ]
    expect(dialogSelectGroupStartIndex(grouped, 0)).toBe(0)
    expect(dialogSelectGroupStartIndex(grouped, 1)).toBe(1)
    expect(dialogSelectGroupStartIndex(grouped, 2)).toBe(3)
    expect(dialogSelectFlatOptions(grouped).map((item) => item.value)).toEqual(["opus", "opus", "sonnet"])
  })

  test("treats falsy non-nullish options as valid current values", () => {
    expect(dialogSelectHasCurrentValue("")).toBe(true)
    expect(dialogSelectHasCurrentValue(0)).toBe(true)
    expect(dialogSelectHasCurrentValue(false)).toBe(true)
    expect(dialogSelectHasCurrentValue(null)).toBe(false)
    expect(dialogSelectHasCurrentValue(undefined)).toBe(false)
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

    expect(dialogSelectRows(grouped)).toBe(6)
    // 40-line terminal: remaining space after overlay margin + select chrome.
    expect(dialogSelectVisibleHeight(20, 40)).toBe(20)
    expect(dialogSelectVisibleHeight(30, 40)).toBe(28)
    // Tiny terminals still show at least one row instead of collapsing to 0.
    expect(dialogSelectVisibleHeight(20, 8)).toBe(1)
    expect(dialogSelectMoveIndex(0, -1, 2)).toBe(1)
    expect(dialogSelectMoveIndex(1, 1, 2)).toBe(0)
    expect(dialogSelectClampIndex(5, 2)).toBe(1)
    expect(dialogSelectClampIndex(-1, 2)).toBe(0)
    expect(dialogSelectClampIndex(5, 0)).toBe(0)
  })

  test("gives /connect a usable page of options instead of two rows", () => {
    // The old `floor(height / 2) - 6` cap left 2 rows in a 16-line split pane
    // and 6 on a standard 24-line terminal.
    expect(dialogSelectVisibleHeight(40, 16)).toBe(4)
    expect(dialogSelectVisibleHeight(40, 24)).toBe(12)
    expect(dialogSelectVisibleHeight(4, 24)).toBe(4)
  })

  test("clamps page jumps at the list edges while single steps keep wrapping", () => {
    // PageDown/PageUp map to ±10: clamp instead of wrapping to the other end.
    expect(dialogSelectMoveIndex(2, 10, 30)).toBe(12)
    expect(dialogSelectMoveIndex(25, 10, 30)).toBe(29)
    expect(dialogSelectMoveIndex(29, 10, 30)).toBe(29)
    expect(dialogSelectMoveIndex(5, -10, 30)).toBe(0)
    expect(dialogSelectMoveIndex(0, -10, 30)).toBe(0)
    expect(dialogSelectMoveIndex(3, 10, 0)).toBe(3)
    // Arrow keys (±1) still wrap around.
    expect(dialogSelectMoveIndex(29, 1, 30)).toBe(0)
    expect(dialogSelectMoveIndex(0, -1, 30)).toBe(29)
  })

  test("resolves the option activated by Enter from the clamped selection", () => {
    const selectable = [options[0], options[1]]

    expect(dialogSelectActionOption(selectable, 1)).toBe(options[1])
    expect(dialogSelectActionOption(selectable, 99)).toBe(options[1])
    expect(dialogSelectActionOption(selectable, -1)).toBe(options[0])
    expect(dialogSelectActionOption([], 0)).toBeUndefined()
  })
})
