import { describe, expect, test } from "vitest"
import { dialogHelpBodyHeight, dialogHelpGroups } from "../../../src/cli/cmd/tui/ui/dialog-help-view-model"
import { Keybinds } from "../../../src/config/schema"

describe("tui dialog help view model", () => {
  test("keeps the help body inside the dialog safe area in tall terminals", () => {
    expect(dialogHelpBodyHeight({ contentRows: 34, terminalHeight: 60 })).toBe(34)
    expect(dialogHelpBodyHeight({ contentRows: 60, terminalHeight: 60 })).toBe(51)
  })

  test("keeps the help dialog scrollable in short terminals", () => {
    expect(dialogHelpBodyHeight({ contentRows: 34, terminalHeight: 30 })).toBe(21)
    expect(dialogHelpBodyHeight({ contentRows: 0, terminalHeight: 30 })).toBe(1)
  })
})

describe("tui dialog help groups", () => {
  test("covers every keybind in the schema exactly once", () => {
    const keys = dialogHelpGroups().flatMap((group) => group.binds.map((bind) => bind.key))
    expect(keys.length).toBe(new Set(keys).size)
    expect(new Set(keys)).toEqual(new Set(Object.keys(Keybinds.shape)))
  })

  test("labels come from the schema descriptions", () => {
    for (const group of dialogHelpGroups()) {
      for (const bind of group.binds) {
        expect(bind.label).toBe(Keybinds.shape[bind.key as keyof typeof Keybinds.shape].description)
      }
    }
  })

  test("previously missing bindings are included in sensible groups", () => {
    const byKey = new Map(dialogHelpGroups().flatMap((group) => group.binds.map((bind) => [bind.key, group.title])))
    expect(byKey.get("session_quick_switch_1")).toBe("Session")
    expect(byKey.get("session_quick_switch_9")).toBe("Session")
    expect(byKey.get("model_favorite_toggle")).toBe("Models & Agents")
    expect(byKey.get("model_cycle_favorite")).toBe("Models & Agents")
    expect(byKey.get("terminal_suspend")).toBe("System")
    expect(byKey.get("sidebar_toggle")).toBe("Navigation")
    expect(byKey.get("permission_fullscreen_toggle")).toBe("Permissions")
  })
})
