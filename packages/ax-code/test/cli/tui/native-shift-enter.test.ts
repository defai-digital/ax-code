import { describe, expect, test } from "vitest"
import {
  isBareReturnKey,
  isNativeShiftEnter,
  shouldDetectNativeShiftEnter,
} from "../../../src/cli/cmd/tui/util/native-shift-enter"

// The FFI modifier query (isNativeShiftPressed) needs a real keyboard and is
// covered by manual/on-device verification; everything below is pure logic.

describe("shouldDetectNativeShiftEnter", () => {
  test("true for Apple Terminal on macOS", () => {
    expect(shouldDetectNativeShiftEnter({ TERM_PROGRAM: "Apple_Terminal" }, "darwin")).toBe(true)
  })

  test("true on Windows regardless of terminal", () => {
    expect(shouldDetectNativeShiftEnter({}, "win32")).toBe(true)
    expect(shouldDetectNativeShiftEnter({ TERM_PROGRAM: "vscode" }, "win32")).toBe(true)
  })

  test("false for protocol-capable terminals on macOS", () => {
    expect(shouldDetectNativeShiftEnter({ TERM_PROGRAM: "iTerm.app" }, "darwin")).toBe(false)
    expect(shouldDetectNativeShiftEnter({ TERM_PROGRAM: "vscode" }, "darwin")).toBe(false)
    expect(shouldDetectNativeShiftEnter({ TERM_PROGRAM: "ghostty" }, "darwin")).toBe(false)
    expect(shouldDetectNativeShiftEnter({}, "darwin")).toBe(false)
  })

  test("false on Linux", () => {
    expect(shouldDetectNativeShiftEnter({ TERM_PROGRAM: "Apple_Terminal" }, "linux")).toBe(false)
  })
})

describe("isBareReturnKey", () => {
  test("bare return qualifies", () => {
    expect(isBareReturnKey({ name: "return" })).toBe(true)
  })

  test("any reported modifier disqualifies", () => {
    expect(isBareReturnKey({ name: "return", shift: true })).toBe(false)
    expect(isBareReturnKey({ name: "return", ctrl: true })).toBe(false)
    expect(isBareReturnKey({ name: "return", meta: true })).toBe(false)
    expect(isBareReturnKey({ name: "return", super: true })).toBe(false)
  })

  test("non-return keys never qualify", () => {
    expect(isBareReturnKey({ name: "linefeed" })).toBe(false)
    expect(isBareReturnKey({ name: "j", ctrl: true })).toBe(false)
  })
})

describe("isNativeShiftEnter", () => {
  // The kimi-code semantics: bare CR + incapable terminal + Shift physically
  // held at OS level => newline, not submit.
  test("bare return + detectable terminal + shift held => newline", () => {
    expect(isNativeShiftEnter({ name: "return" }, { detect: true, shiftPressed: true })).toBe(true)
  })

  test("shift not held => ordinary Enter (submit)", () => {
    expect(isNativeShiftEnter({ name: "return" }, { detect: true, shiftPressed: false })).toBe(false)
  })

  test("capable terminal => terminal protocol handles it instead", () => {
    expect(isNativeShiftEnter({ name: "return" }, { detect: false, shiftPressed: true })).toBe(false)
  })

  test("already-modified events are left to the keybind layer", () => {
    expect(isNativeShiftEnter({ name: "return", shift: true }, { detect: true, shiftPressed: true })).toBe(false)
    expect(isNativeShiftEnter({ name: "return", ctrl: true }, { detect: true, shiftPressed: true })).toBe(false)
  })
})
