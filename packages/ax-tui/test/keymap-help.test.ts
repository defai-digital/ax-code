import { describe, expect, test } from "vitest"
import { createKeymapHelpEntries, formatKeymapKeys } from "../src/lib/keymap-help.js"

describe("keymap help metadata", () => {
  test("formats AX aliases, modifiers, Unicode and sequences without implying Shift", () => {
    expect(formatKeymapKeys("alt+shift+ctrl+k")).toBe("Ctrl+Shift+Alt+k")
    expect(formatKeymapKeys("meta+k")).toBe("Alt+k")
    expect(formatKeymapKeys(["ctrl+k", "ctrl+c"])).toBe("Ctrl+k Ctrl+c")
    expect(formatKeymapKeys(["g", "g"])).toBe("g g")
    expect(formatKeymapKeys(["return", "esc", "space", "plus", "f12"])).toBe("Enter Esc Space Plus F12")
    expect(formatKeymapKeys(["ctrl+ ", "super+hyper+界", "👩‍💻"])).toBe("Ctrl+Space Super+Hyper+界 👩‍💻")
    expect(formatKeymapKeys("constructor")).toBe("constructor")
    expect(formatKeymapKeys([])).toBe("")
  })

  test("searches names, descriptions, raw aliases and formatted keys with Unicode normalization", () => {
    const bindings = [
      { id: "commit", keys: ["ctrl+s"], description: "Save café" },
      { id: "go", keys: ["return"], description: "Open record" },
      { id: "search", keys: ["界"], description: "搜尋記錄" },
    ]
    for (const query of ["COMMIT", "save", "CTRL+S", "cafe\u0301"]) {
      expect(createKeymapHelpEntries(bindings, query).map((entry) => entry.id)).toEqual(["commit"])
    }
    expect(createKeymapHelpEntries(bindings, "return").map((entry) => entry.id)).toEqual(["go"])
    expect(createKeymapHelpEntries(bindings, "Enter").map((entry) => entry.id)).toEqual(["go"])
    expect(createKeymapHelpEntries(bindings, "搜尋").map((entry) => entry.id)).toEqual(["search"])
    expect(createKeymapHelpEntries(bindings, "missing")).toEqual([])
    expect(createKeymapHelpEntries(bindings, " \t\n ")).toHaveLength(3)
    expect(createKeymapHelpEntries([])).toEqual([])
  })

  test("preserves duplicate IDs and order without retaining or mutating source objects", () => {
    const bindings = Object.freeze([
      Object.freeze({ id: "same", keys: Object.freeze(["x"]), description: "First layer", target: {} }),
      Object.freeze({ id: "same", keys: Object.freeze(["x"]), description: "Second layer" }),
      Object.freeze({ id: "fallback", keys: Object.freeze(["q"]), description: "   " }),
    ])
    const entries = createKeymapHelpEntries(bindings)
    expect(entries.map((entry) => entry.description)).toEqual(["First layer", "Second layer", "fallback"])
    expect(entries[0]).toEqual({ id: "same", shortcut: "x", description: "First layer" })
    entries[0].description = "changed"
    expect(bindings[0].description).toBe("First layer")
  })

  test("search treats Unicode spacing like ordinary spaces without changing the displayed label", () => {
    for (const space of ["\u00a0", "\u202f", "\u3000"]) {
      const description = `Open${space}record`
      const bindings = [{ id: "open", keys: ["return"], description }]
      expect(createKeymapHelpEntries(bindings, "open record")[0]?.description).toBe(description)
      expect(createKeymapHelpEntries(bindings, `open${space}record`)).toHaveLength(1)
    }
  })

  test("keeps each metadata field plain and on one logical line", () => {
    const entries = createKeymapHelpEntries([{
      id: "unsafe\nname", keys: ["ctrl+\x1b[31mk\x1b[0m"],
      description: "\x1b]8;;https://example.com\x07Open\x1b]8;;\x07\n\t文件\x00\x7f\x85next\u2028line",
    }])
    expect(entries).toEqual([{ id: "unsafe name", shortcut: "Ctrl+k", description: "Open 文件 next line" }])
    expect(createKeymapHelpEntries([{ id: "cafe\u0301 👩‍💻", keys: ["q"] }])[0].description).toBe("cafe\u0301 👩‍💻")
  })
})
