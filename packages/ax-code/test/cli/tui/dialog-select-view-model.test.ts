import { describe, expect, test } from "vitest"
import {
  dialogSelectActionOption,
  dialogSelectClampIndex,
  dialogSelectFlatOptions,
  dialogSelectGroupStartIndex,
  dialogSelectGroupedOptions,
  dialogSelectHasCurrentValue,
  dialogSelectFooterHints,
  dialogSelectMoveIndex,
  dialogSelectOptionLine,
  dialogSelectRows,
  dialogSelectTitleWidth,
  dialogSelectVisibleHeight,
} from "../../../src/cli/tui/ui/dialog-select-view-model"
import { truncateCells } from "../../../src/cli/tui/ui/cell-text"
import { stringWidth } from "../../../src/bun/node-compat"

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

  test("ranks a title match above a category-only match", () => {
    // Pins the existing weighting: fuzzysort normalizes a key score to 0..1, so
    // an exact category hit scores 1.0 exactly like an exact title hit. The
    // title weighting in `scoreFn` is what keeps the title hits ahead of
    // "Branch"; dropping it would promote the category-only match to the top.
    const ranked = dialogSelectGroupedOptions({
      options: [
        { title: "Branch", value: "branch", category: "git" },
        { title: "git commit", value: "commit" },
        { title: "GitHub", value: "github" },
      ],
      query: "git",
    })

    expect(dialogSelectFlatOptions(ranked).map((option) => option.value)).toEqual(["github", "commit", "branch"])
  })

  test("derives row count, visible height, and wrapped movement", () => {
    const grouped = dialogSelectGroupedOptions({ options, query: "" })

    expect(dialogSelectRows(grouped)).toBe(6)
    // 40-line terminal: remaining space after overlay margin + select chrome.
    expect(dialogSelectVisibleHeight(20, 40)).toBe(20)
    expect(dialogSelectVisibleHeight(30, 40)).toBe(26)
    // Tiny terminals still show at least one row instead of collapsing to 0.
    expect(dialogSelectVisibleHeight(20, 8)).toBe(1)
    expect(dialogSelectMoveIndex(0, -1, 2)).toBe(1)
    expect(dialogSelectMoveIndex(1, 1, 2)).toBe(0)
    expect(dialogSelectClampIndex(5, 2)).toBe(1)
    expect(dialogSelectClampIndex(-1, 2)).toBe(0)
    expect(dialogSelectClampIndex(5, 0)).toBe(0)
  })

  test("grants only rows the dialog frame can display, so overflow always raises the scrollbar", () => {
    // The old `floor(height / 2) - 6` cap left 2 rows in a 16-line split pane
    // and 6 on a standard 24-line terminal. The body height must stay within
    // what the frame actually grants: promising more silently clipped the
    // remainder with no scrollbar (rows were neither visible nor scrollable
    // in any signaled way). A 5-option provider action menu at 16 lines now
    // shows 2 rows and a scrollbar instead of 2 rows and 3 hidden options.
    expect(dialogSelectVisibleHeight(40, 16)).toBe(2)
    expect(dialogSelectVisibleHeight(40, 24)).toBe(10)
    expect(dialogSelectVisibleHeight(4, 24)).toBe(4)
    expect(dialogSelectVisibleHeight(5, 16)).toBe(2)
    expect(dialogSelectVisibleHeight(8, 16)).toBe(2)
    // Overflow signal fidelity: the body is strictly smaller than the content
    // exactly when the frame cannot show all of it.
    expect(dialogSelectVisibleHeight(5, 16)).toBeLessThan(5)
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

describe("tui dialog select row fitting", () => {
  const longTitle = "Cyber-Tiel Coder 35B A3B AXQ MXFP4 MTP (Local MLX)"

  test("leaves a row untouched until the slot is measured", () => {
    expect(dialogSelectOptionLine({ slotWidth: 0, title: longTitle, description: "x", footerWidth: 8 })).toEqual({
      title: longTitle,
      description: "x",
      showFooter: true,
    })
  })

  test("keeps title, description, and footer when everything fits", () => {
    expect(
      dialogSelectOptionLine({ slotWidth: 40, title: "Switch model", description: "Recent", footerWidth: 8 }),
    ).toEqual({ title: "Switch model", description: "Recent", showFooter: true })
  })

  test("shortens, then drops, the description before touching the title", () => {
    const shortened = dialogSelectOptionLine({ slotWidth: 24, title: "Claude Opus 5.5", description: "Anthropic API" })
    expect(shortened.title).toBe("Claude Opus 5.5")
    expect(shortened.description).toBe("Anthrop…")
    const dropped = dialogSelectOptionLine({ slotWidth: 18, title: "Claude Opus 5.5", description: "Anthropic API" })
    expect(dropped).toEqual({ title: "Claude Opus 5.5", showFooter: true })
  })

  test("drops the footer column before cutting the title", () => {
    const line = dialogSelectOptionLine({ slotWidth: 20, title: "Open the editor now", footerWidth: 8 })
    expect(line).toEqual({ title: "Open the editor now", showFooter: false })
  })

  test("truncates an over-long title with an ellipsis inside the slot", () => {
    const line = dialogSelectOptionLine({ slotWidth: 46, title: longTitle, description: "AX_ENGINE", footerWidth: 8 })
    expect(line.showFooter).toBe(false)
    expect(line.description).toBeUndefined()
    expect(line.title.endsWith("…")).toBe(true)
    expect(stringWidth(line.title)).toBeLessThanOrEqual(46)
  })

  test.each([1, 5, 20, 37, 46, 80])("never exceeds a %i-cell slot", (slot) => {
    const line = dialogSelectOptionLine({ slotWidth: slot, title: longTitle + " 👀 🌐", description: "Local" })
    const width = stringWidth(line.title) + (line.description ? 1 + stringWidth(line.description) : 0)
    expect(width).toBeLessThanOrEqual(slot)
  })

  test("derives the title budget from the frame width", () => {
    expect(dialogSelectTitleWidth(60, "esc")).toBe(46)
    expect(dialogSelectTitleWidth(36, "esc clear")).toBe(16)
    expect(dialogSelectTitleWidth(8, "esc")).toBe(0)
  })

  test("keeps whole footer hints in priority order", () => {
    const hints = [
      { id: "connect", width: 23 },
      { id: "favorite", width: 15 },
    ]
    expect(dialogSelectFooterHints(hints, 60).map((hint) => hint.id)).toEqual(["connect", "favorite"])
    expect(dialogSelectFooterHints(hints, 40).map((hint) => hint.id)).toEqual(["connect"])
    expect(dialogSelectFooterHints(hints, 20)).toEqual([])
  })
})

describe("truncateCells", () => {
  test("returns text that fits unchanged", () => {
    expect(truncateCells("Switch model", 12)).toBe("Switch model")
  })

  test("ends a cut with a one-cell ellipsis", () => {
    expect(truncateCells("Switch model", 8)).toBe("Switch…")
    expect(truncateCells("Switch model", 1)).toBe("…")
    expect(truncateCells("Switch model", 0)).toBe("")
  })

  test("drops a wide glyph whole instead of splitting it", () => {
    const cut = truncateCells("模型選擇器", 6)
    expect(cut).toBe("模型…")
    expect(stringWidth(cut)).toBeLessThanOrEqual(6)
  })
})
