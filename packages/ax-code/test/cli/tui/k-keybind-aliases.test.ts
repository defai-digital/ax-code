import { describe, test, expect } from "vitest"
import { Keybind } from "../../../src/util/keybind"

// Regression coverage for section 25: user-facing key spellings must map to the
// event names the parser emits so config strings round-trip with `toString` and
// match real key events. Before the fix, `parse` only aliased `esc`; `enter`,
// `del`, and `kpenter` were passed through verbatim and never matched the
// actual `return`/`delete` events — including the app's own displayed `del`
// hint, which `toString` prints but `parse` could not read back.
describe("Keybind.parse aliases", () => {
  test("aliases enter -> return", () => {
    expect(Keybind.parse("enter")).toEqual([{ ctrl: false, meta: false, shift: false, leader: false, name: "return" }])
  })

  test("aliases del -> delete (round-trips toString output)", () => {
    // toString prints `del` for the `delete` event; parsing that back must
    // yield the `delete` event again.
    const info: Keybind.Info = { ctrl: true, meta: false, shift: false, leader: false, name: "delete" }
    expect(Keybind.toString(info)).toBe("ctrl+del")
    expect(Keybind.parse("ctrl+del")).toEqual([info])
  })

  test("aliases esc -> escape (unchanged behavior)", () => {
    expect(Keybind.parse("esc")).toEqual([{ ctrl: false, meta: false, shift: false, leader: false, name: "escape" }])
  })

  test("aliases kpenter -> return", () => {
    expect(Keybind.parse("kpenter")).toEqual([
      { ctrl: false, meta: false, shift: false, leader: false, name: "return" },
    ])
  })

  test("ctrl+enter matches a ctrl+return key event", () => {
    const [binding] = Keybind.parse("ctrl+enter")
    const event = Keybind.fromEvent({ name: "return", ctrl: true, meta: false, shift: false })
    expect(Keybind.match(binding, event)).toBe(true)
  })

  test("aliases apply alongside modifiers and combos", () => {
    expect(Keybind.parse("ctrl+enter,shift+del")).toEqual([
      { ctrl: true, meta: false, shift: false, leader: false, name: "return" },
      { ctrl: false, meta: false, shift: true, leader: false, name: "delete" },
    ])
  })

  test("non-aliased names are untouched", () => {
    expect(Keybind.parse("return")).toEqual([{ ctrl: false, meta: false, shift: false, leader: false, name: "return" }])
    expect(Keybind.parse("home")).toEqual([{ ctrl: false, meta: false, shift: false, leader: false, name: "home" }])
  })
})
