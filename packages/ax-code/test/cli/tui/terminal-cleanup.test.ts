import { describe, expect, test, vi } from "vitest"

// Keep the Flag module out of the test environment; an empty Flag map means
// AX_CODE_TUI_ADVANCED_TERMINAL is unset, i.e. the default main-screen profile.
vi.mock("@/flag/flag", () => ({ Flag: {} }))

import {
  resetTuiTerminalState,
  TUI_MAIN_SCREEN_CLEAR_SEQUENCE,
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
})
