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
  TUI_MOUSE_TRACKING_DISABLE_SEQUENCE,
  TUI_TERMINAL_CRASH_RESET_SEQUENCE,
  TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE,
  TUI_TERMINAL_TITLE_CLEAR_SEQUENCE,
} from "../../../src/cli/tui/terminal-cleanup"

const ERASE_DISPLAY = "\x1b[2J"
const LEAVE_ALTERNATE_SCREEN = "\x1b[?1049l"
const CURSOR_SHOW = "\x1b[?25h"
const BRACKETED_PASTE_OFF = "\x1b[?2004l"

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

function fakeTtyStdin(events: string[]) {
  return {
    isTTY: true,
    setRawMode: (mode: boolean) => {
      events.push(`setRawMode(${mode})`)
    },
  }
}

describe("split-footer crash reset", () => {
  test("omits ESC[2J and ESC[?1049l", () => {
    const reset = createTuiTerminalCrashResetSequence({ screenMode: "split-footer" })
    expect(reset).not.toContain(ERASE_DISPLAY)
    expect(reset).not.toContain(LEAVE_ALTERNATE_SCREEN)
  })

  test("keeps every other reset", () => {
    const reset = createTuiTerminalCrashResetSequence({ screenMode: "split-footer" })
    expect(reset).toContain(TUI_MOUSE_TRACKING_DISABLE_SEQUENCE)
    expect(reset).toContain(TUI_MODIFY_OTHER_KEYS_DISABLE_SEQUENCE)
    expect(reset).toContain(TUI_KITTY_KEYBOARD_POP_SEQUENCE)
    expect(reset).toContain(BRACKETED_PASTE_OFF)
    expect(reset).toContain(CURSOR_SHOW)
    expect(reset).toContain(TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE)
    expect(reset).toContain(TUI_TERMINAL_TITLE_CLEAR_SEQUENCE)
  })

  test("honors the Kitty opt-out without reintroducing the alt-screen exit", () => {
    const reset = createTuiTerminalCrashResetSequence({ screenMode: "split-footer", kittyKeyboard: false })
    expect(reset).not.toContain(TUI_KITTY_KEYBOARD_POP_SEQUENCE)
    expect(reset).not.toContain(LEAVE_ALTERNATE_SCREEN)
    expect(reset).not.toContain(ERASE_DISPLAY)
  })

  test("resetTuiTerminalState writes no clear and no alt-screen exit", () => {
    const { stream, writes } = fakeStdout()
    const events: string[] = []
    const restored = resetTuiTerminalState({
      stdout: stream,
      stdin: fakeTtyStdin(events),
      screenMode: "split-footer",
    })

    expect(restored).toBe(true)
    expect(writes).toHaveLength(1)
    expect(writes[0]).not.toContain(ERASE_DISPLAY)
    expect(writes[0]).not.toContain(LEAVE_ALTERNATE_SCREEN)
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE.replace(LEAVE_ALTERNATE_SCREEN, ""))
    // Raw mode is still restored after the protocol resets.
    expect(events).toEqual(["setRawMode(false)"])
  })
})

describe("existing screen modes are unchanged", () => {
  test("alternate-screen keeps the alt-screen exit and no display clear", () => {
    const reset = createTuiTerminalCrashResetSequence({ screenMode: "alternate-screen" })
    expect(reset).toContain(LEAVE_ALTERNATE_SCREEN)
    expect(reset).not.toContain(ERASE_DISPLAY)

    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({ stdout: stream, stdin: notTty, screenMode: "alternate-screen" })
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE)
    expect(writes[0]).toContain(LEAVE_ALTERNATE_SCREEN)
    expect(writes[0]).not.toContain(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("main-screen keeps both the alt-screen exit and the display clear", () => {
    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({ stdout: stream, stdin: notTty, screenMode: "main-screen" })
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE + TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
    expect(writes[0]).toContain(LEAVE_ALTERNATE_SCREEN)
    expect(writes[0]).toContain(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("an omitted screenMode still falls back to the env-derived mode", () => {
    // The mocked Flag map has no AX_CODE_TUI_ADVANCED_TERMINAL, so the
    // pre-existing fallback resolves to main-screen — including its clear.
    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({ stdout: stream, stdin: notTty })
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE + TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("an explicit legacy alternate-screen mode is unchanged", () => {
    const { stream, writes } = fakeStdout()
    resetTuiTerminalState({ stdout: stream, stdin: notTty, screenMode: "alternate-screen" })
    expect(writes[0]).toBe(TUI_TERMINAL_CRASH_RESET_SEQUENCE)
    expect(TUI_TERMINAL_CRASH_RESET_SEQUENCE).toBe(createTuiTerminalCrashResetSequence())
  })
})
