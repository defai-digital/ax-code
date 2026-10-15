import { describe, expect, test } from "vitest"
import {
  EXIT_CONFIRM_WINDOW_MS,
  createExitConfirmGate,
  isPlainCtrlC,
} from "../../../src/cli/tui/component/prompt/exit-confirm"

function clock(start = 0) {
  let value = start
  return {
    now: () => value,
    advance: (ms: number) => {
      value += ms
    },
  }
}

describe("exit confirm gate", () => {
  test("arms on the first press and exits on the second inside the window", () => {
    const time = clock()
    const gate = createExitConfirmGate({ now: time.now })
    expect(gate.press()).toBe("arm")
    time.advance(500)
    expect(gate.press()).toBe("exit")
  })

  test("an expired window re-arms instead of exiting", () => {
    const time = clock()
    const gate = createExitConfirmGate({ now: time.now, windowMs: 2_000 })
    expect(gate.press()).toBe("arm")
    time.advance(2_001)
    expect(gate.press()).toBe("arm")
    // The re-arm starts a fresh window: a press inside it exits.
    time.advance(1_000)
    expect(gate.press()).toBe("exit")
  })

  test("a press exactly at the window boundary still exits", () => {
    const time = clock()
    const gate = createExitConfirmGate({ now: time.now })
    expect(gate.press()).toBe("arm")
    time.advance(EXIT_CONFIRM_WINDOW_MS)
    expect(gate.press()).toBe("exit")
  })

  test("reset disarms so the next press arms again", () => {
    const time = clock()
    const gate = createExitConfirmGate({ now: time.now })
    expect(gate.press()).toBe("arm")
    gate.reset()
    time.advance(100)
    expect(gate.press()).toBe("arm")
  })

  test("a completed exit consumes the arm so a later press arms fresh", () => {
    const time = clock()
    const gate = createExitConfirmGate({ now: time.now })
    expect(gate.press()).toBe("arm")
    expect(gate.press()).toBe("exit")
    expect(gate.press()).toBe("arm")
  })

  test("the default window matches the documented 2000 ms", () => {
    expect(EXIT_CONFIRM_WINDOW_MS).toBe(2_000)
  })
})

describe("isPlainCtrlC", () => {
  test("matches only an unmodified Ctrl+C", () => {
    expect(isPlainCtrlC({ name: "c", ctrl: true })).toBe(true)
    expect(isPlainCtrlC({ name: "c", ctrl: true, meta: false, shift: false })).toBe(true)
    expect(isPlainCtrlC({ name: "c", ctrl: true, shift: true })).toBe(false)
    expect(isPlainCtrlC({ name: "c", ctrl: true, meta: true })).toBe(false)
    expect(isPlainCtrlC({ name: "c" })).toBe(false)
    expect(isPlainCtrlC({ name: "c", ctrl: false })).toBe(false)
    expect(isPlainCtrlC({ name: "d", ctrl: true })).toBe(false)
  })
})
