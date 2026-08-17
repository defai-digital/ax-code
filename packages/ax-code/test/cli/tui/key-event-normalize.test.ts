import { describe, test, expect } from "vitest"
import { normalizeKeyEventForKeybind } from "../../../src/cli/cmd/tui/util/keys"

// Legacy terminals cannot report Ctrl+J distinctly: raw mode emits the LF
// byte, parsed as an UNMODIFIED "linefeed" key (CSI-u reports "\n"). The
// keybind layer normalizes these to "j"+ctrl so `ctrl+j` bindings — the
// default input_newline — match. Before this, Ctrl+J fell through to the
// Enter-alias handling and submitted the prompt.
describe("normalizeKeyEventForKeybind", () => {
  test("legacy linefeed byte (Ctrl+J) normalizes to ctrl+j", () => {
    expect(normalizeKeyEventForKeybind({ name: "linefeed" })).toEqual({ name: "j", ctrl: true })
  })

  test("CSI-u LF normalizes to ctrl+j", () => {
    expect(normalizeKeyEventForKeybind({ name: "\n" })).toEqual({ name: "j", ctrl: true })
  })

  test("modified linefeed is untouched (alt+enter stays meta+linefeed)", () => {
    const evt = { name: "linefeed", meta: true }
    expect(normalizeKeyEventForKeybind(evt)).toEqual({ name: "linefeed", meta: true })
  })

  test("plain return (Enter) is untouched", () => {
    expect(normalizeKeyEventForKeybind({ name: "return" })).toEqual({ name: "return" })
  })

  test("ctrl+_ (legacy 0x1F) normalizes to ctrl+-", () => {
    expect(normalizeKeyEventForKeybind({ name: "_", ctrl: true })).toEqual({ name: "-", ctrl: true })
  })
})
