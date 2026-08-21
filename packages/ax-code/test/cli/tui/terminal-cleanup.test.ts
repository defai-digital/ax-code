import { describe, expect, test, vi } from "vitest"

// Keep the Flag module out of the test environment; an empty Flag map means
// AX_CODE_TUI_ADVANCED_TERMINAL is unset, i.e. the default main-screen profile.
vi.mock("@/flag/flag", () => ({ Flag: {} }))

import {
  createTuiTerminalCrashResetSequence,
  resetTuiTerminalState,
  TUI_KITTY_KEYBOARD_POP_SEQUENCE,
  TUI_MAIN_SCREEN_CLEAR_SEQUENCE,
  TUI_MODIFY_OTHER_KEYS_DISABLE_SEQUENCE,
  TUI_MODIFY_OTHER_KEYS_ENABLE_SEQUENCE,
  TUI_TERMINAL_CRASH_RESET_SEQUENCE,
} from "../../../src/cli/cmd/tui/terminal-cleanup"

function fakeStdout() {
  const writes: string[] = []
  const stream = {
    writable: true as boolean,
    destroyed: false,
    write: (chunk: string, callback?: () => void) => {
      writes.push(chunk)
      callback?.()
      return true
    },
  }
  return { stream, writes }
}

const notTty = { isTTY: false }

describe("resetTuiTerminalState", () => {
  test("main-screen mode also erases the stale TUI frame", () => {
    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({ stdout: stream, stdin: notTty, screenMode: "main-screen" })
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE + TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("alternate-screen mode does not clear (leaving the alt screen restores the shell view)", () => {
    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({ stdout: stream, stdin: notTty, screenMode: "alternate-screen" })
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE)
  })

  test("defaults to the main-screen profile when the advanced-terminal flag is unset", () => {
    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({ stdout: stream, stdin: notTty })
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE + TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("writes nothing when stdout is not writable", () => {
    const { stream, writes } = fakeStdout()
    stream.writable = false
    resetTuiTerminalState({ stdout: stream, stdin: notTty, screenMode: "main-screen" })
    expect(writes).toEqual([])
  })

  test("honors the Kitty opt-out while still resetting native modifyOtherKeys", () => {
    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({
      stdout: stream,
      stdin: notTty,
      screenMode: "alternate-screen",
      kittyKeyboard: false,
    })
    expect(writes).toEqual([createTuiTerminalCrashResetSequence({ kittyKeyboard: false })])
    expect(writes[0]).toContain(TUI_MODIFY_OTHER_KEYS_DISABLE_SEQUENCE)
    expect(writes[0]).not.toContain(TUI_KITTY_KEYBOARD_POP_SEQUENCE)
  })
})

describe("modifyOtherKeys (Shift+Enter on non-Kitty terminals)", () => {
  // xterm mode 2 must be enabled at startup and reset on crash — otherwise
  // xterm.js-family terminals (VS Code, iTerm2 legacy) keep collapsing
  // Shift+Enter to a bare CR, which submits the prompt instead of inserting
  // a newline. renderTui opts into mode 2, the native renderer owns normal
  // teardown, and this module supplies the fallback reset after a crash.
  test("enable/disable sequences use the xterm modifyOtherKeys mode 2 encoding", () => {
    expect(TUI_MODIFY_OTHER_KEYS_ENABLE_SEQUENCE).toBe("\x1b[>4;2m")
    expect(TUI_MODIFY_OTHER_KEYS_DISABLE_SEQUENCE).toBe("\x1b[>4;0m")
  })

  test("crash reset sequence turns modifyOtherKeys back off", () => {
    expect(TUI_TERMINAL_CRASH_RESET_SEQUENCE).toContain(TUI_MODIFY_OTHER_KEYS_DISABLE_SEQUENCE)
  })
})

describe("kitty keyboard crash recovery", () => {
  test("pop restores the terminal's flags", () => {
    expect(TUI_KITTY_KEYBOARD_POP_SEQUENCE).toBe("\x1b[<u")
  })

  test("default crash reset pops Kitty flags when the protocol was enabled", () => {
    expect(TUI_TERMINAL_CRASH_RESET_SEQUENCE).toContain(TUI_KITTY_KEYBOARD_POP_SEQUENCE)
  })
})
