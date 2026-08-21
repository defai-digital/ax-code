import { describe, expect, test, vi } from "vitest"

// Keep the Flag module out of the test environment; an empty Flag map means
// AX_CODE_TUI_ADVANCED_TERMINAL is unset, i.e. the default main-screen profile.
vi.mock("@/flag/flag", () => ({ Flag: {} }))

import {
  createTuiTerminalCrashResetSequence,
  drainTuiStdin,
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

  function fakeTtyStdin(events: string[]) {
    const stream = {
      isTTY: true,
      setRawMode: (mode: boolean) => {
        events.push(`setRawMode(${mode})`)
      },
    }
    return stream
  }

  test("writes the protocol reset BEFORE restoring stdin raw mode", () => {
    // Once the terminal stops reporting Kitty/modifyOtherKeys sequences,
    // in-flight key releases stop generating escape bytes that would drain
    // into the shell after teardown — so the reset must land first.
    const events: string[] = []
    const { stream } = fakeStdout()
    const write = stream.write
    stream.write = (chunk: string, callback?: () => void) => {
      events.push("stdout.write")
      return write(chunk, callback)
    }
    resetTuiTerminalState({ stdout: stream, stdin: fakeTtyStdin(events), screenMode: "alternate-screen" })
    expect(events).toEqual(["stdout.write", "setRawMode(false)"])
  })

  test("still restores stdin raw mode when stdout is not writable", () => {
    const events: string[] = []
    const { stream, writes } = fakeStdout()
    stream.writable = false
    resetTuiTerminalState({ stdout: stream, stdin: fakeTtyStdin(events), screenMode: "main-screen" })
    expect(writes).toEqual([])
    expect(events).toEqual(["setRawMode(false)"])
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

describe("drainTuiStdin", () => {
  function fakeDrainableStdin() {
    const listeners = new Set<(chunk: unknown) => void>()
    const calls: string[] = []
    const stream = {
      isTTY: true,
      destroyed: false,
      resume: () => {
        calls.push("resume")
      },
      pause: () => {
        calls.push("pause")
      },
      on: (_event: "data", listener: (chunk: unknown) => void) => {
        listeners.add(listener)
      },
      off: (_event: "data", listener: (chunk: unknown) => void) => {
        listeners.delete(listener)
      },
      emit: (chunk: unknown) => {
        for (const listener of [...listeners]) listener(chunk)
      },
      listenerCount: () => listeners.size,
    }
    return { stream, calls }
  }

  test("resolves immediately for non-TTY stdin", async () => {
    await drainTuiStdin({ stream: { isTTY: false }, timeoutMs: 10, idleMs: 5 })
  })

  test("discards late input bytes, then pauses and detaches once idle", async () => {
    const { stream, calls } = fakeDrainableStdin()
    const drained = drainTuiStdin({ stream, timeoutMs: 500, idleMs: 10 })
    expect(calls).toEqual(["resume"])
    // Late Kitty key-release bytes arriving after teardown are swallowed.
    stream.emit("\x1b[13;1:3u")
    stream.emit("\x1b[97;1:3u")
    await drained
    expect(stream.listenerCount()).toBe(0)
    expect(calls).toEqual(["resume", "pause"])
  })

  test("is bounded by the hard cap when bytes keep arriving", async () => {
    const { stream, calls } = fakeDrainableStdin()
    const started = Date.now()
    const interval = setInterval(() => stream.emit("x"), 2)
    interval.unref()
    await drainTuiStdin({ stream, timeoutMs: 30, idleMs: 60_000 })
    clearInterval(interval)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(calls).toContain("pause")
  })
})
