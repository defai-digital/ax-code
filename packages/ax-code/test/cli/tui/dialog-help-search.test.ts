import { describe, expect, test } from "vitest"
import { dialogHelpSearchGroups } from "../../../src/cli/tui/ui/dialog-help-search"
import { dialogHelpGroups } from "../../../src/cli/tui/ui/dialog-help-view-model"
import { Keybind } from "../../../src/util/keybind"
import { Keybinds } from "../../../src/config/schema"
import { translate } from "../../../src/cli/tui/i18n"

const groups = [
  {
    title: "Navigation",
    binds: [
      { key: "session_list", label: "Switch session" },
      { key: "session_new", label: "New session" },
    ],
  },
  { title: "Input", binds: [{ key: "input_delete", label: "Delete input" }] },
]
const keys: Record<string, string> = { session_list: "ctrl+x l", session_new: "ctrl+n", input_delete: "" }
const print = (key: string) => keys[key] ?? ""

describe("searchable keyboard help", () => {
  test("preserves grouping and key spelling while omitting unbound entries", () => {
    expect(dialogHelpSearchGroups(groups, print, "  ")).toEqual([
      {
        title: "Navigation",
        binds: [
          { ...groups[0].binds[0], shortcut: "ctrl+x l" },
          { ...groups[0].binds[1], shortcut: "ctrl+n" },
        ],
      },
    ])
  })

  test("matches labels, schema ids, configured chords, and category names", () => {
    for (const query of ["SWITCH", "session_list", "CTRL+X"]) {
      expect(
        dialogHelpSearchGroups(groups, print, query).flatMap((group) => group.binds.map((bind) => bind.key)),
      ).toEqual(["session_list"])
    }
    expect(dialogHelpSearchGroups(groups, print, "navigation")[0].binds).toHaveLength(2)
    expect(dialogHelpSearchGroups(groups, print, "missing")).toEqual([])
  })

  test("uses current bindings on every search without retaining old matches", () => {
    expect(dialogHelpSearchGroups(groups, () => "", "")).toEqual([])
    expect(dialogHelpSearchGroups(groups, () => "alt+s", "ctrl+x")).toEqual([])
    expect(dialogHelpSearchGroups(groups, () => "alt+s", "ALT+S")).toHaveLength(2)
  })

  test("searches alternative configured chords while displaying the primary binding", () => {
    const found = dialogHelpSearchGroups(groups, print, "ctrl+n", (key) => (key === "session_list" ? ["ctrl+n"] : []))
    expect(found[0].binds.map((bind) => [bind.key, bind.shortcut])).toEqual([
      ["session_list", "ctrl+x l"],
      ["session_new", "ctrl+n"],
    ])
  })

  test("matches composed Unicode and localized labels without changing display text", () => {
    const localized = [
      {
        title: "\u5c0e\u89bd",
        binds: [{ key: "session_list", label: "Caf\u00e9 \u5207\u63db\u5de5\u4f5c\u968e\u6bb5" }],
      },
    ]
    for (const query of ["cafe\u0301", "\u5207\u63db", "\u5c0e\u89bd"]) {
      expect(dialogHelpSearchGroups(localized, print, query)[0].binds[0].label).toBe(localized[0].binds[0].label)
    }
  })

  test("keeps empty-query help identical to the schema and first configured binding in both locales", () => {
    const configured = Keybinds.parse({ session_new: "alt+n,ctrl+n", session_list: "none" })
    const resolved = Object.fromEntries(Object.entries(configured).map(([key, value]) => [key, Keybind.parse(value)]))
    const display = (key: string) => Keybind.toDisplayString(resolved[key]?.[0], resolved.leader?.[0])
    for (const locale of ["en", "zh-TW"] as const) {
      const original = dialogHelpGroups((key, params) => translate(locale, key, params))
      const expected = original
        .map((group) => ({
          title: group.title,
          binds: group.binds
            .filter((bind) => display(bind.key))
            .map((bind) => ({ ...bind, shortcut: display(bind.key) })),
        }))
        .filter((group) => group.binds.length)
      const actual = dialogHelpSearchGroups(original, display, "")
      expect(actual).toEqual(expected)
      expect(actual.flatMap((group) => group.binds).find((bind) => bind.key === "session_new")?.shortcut).toBe("alt+n")
    }
  })
})
