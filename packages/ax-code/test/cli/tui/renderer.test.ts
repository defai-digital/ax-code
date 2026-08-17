import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  clearTuiTerminalTitle,
  createTuiRenderOptionsFromProfile,
  destroyTuiRenderer,
  resolveTuiRenderProfile,
  setTuiTerminalProgress,
  setTuiTerminalTitle,
  shouldAnimateTuiTitleSpinner,
  supportsTuiTerminalProgress,
  TUI_TERMINAL_PROGRESS_KEEPALIVE_MS,
} from "../../../src/cli/cmd/tui/renderer"
import {
  clearTuiMainScreen,
  disableTuiMouseTracking,
  flushTuiStdout,
  resetTuiTerminalState,
  TUI_MAIN_SCREEN_CLEAR_SEQUENCE,
  TUI_TERMINAL_CRASH_RESET_SEQUENCE,
  TUI_MOUSE_TRACKING_DISABLE_SEQUENCE,
  TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE,
  TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE,
} from "../../../src/cli/cmd/tui/terminal-cleanup"

const TITLE_CLEAR_SEQUENCE = "\x1b]0;\x07"

function captureStream(writes: string[] = []) {
  return {
    writes,
    stream: {
      writable: true,
      write(chunk: string) {
        writes.push(chunk)
        return true
      },
    },
  }
}

describe("tui renderer profile", () => {
  test("keeps the compatibility profile production-safe", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    const options = createTuiRenderOptionsFromProfile(profile)

    expect(profile.profile).toBe("compatible")
    expect(profile.exitOnCtrlC).toBe(false)
    // Terminal title/progress are probe-free OSC escapes written straight to
    // stdout, allowed in all profiles unless AX_CODE_DISABLE_TERMINAL_TITLE
    // opts out.
    expect(profile.allowTerminalTitle).toBe(true)
    expect(options.exitOnCtrlC).toBe(false)
    expect(options.useThread).toBe(false)
    expect(options.useMouse).toBe(true)
    expect(options.screenMode).toBe("main-screen")
    // Kitty keyboard is probe-free (fire-and-forget flags push) and enabled
    // in all profiles by default — Shift+Enter newline depends on it.
    expect(options.useKittyKeyboard).toEqual({})
  })

  test("kitty keyboard opt-out disables the flags push in both profiles", () => {
    for (const advancedTerminal of [false, true]) {
      const profile = resolveTuiRenderProfile({
        advancedTerminal,
        terminalTitleDisabled: false,
        kittyKeyboard: false,
      })
      const options = createTuiRenderOptionsFromProfile(profile)
      expect(profile.useKittyKeyboard).toBe(false)
      expect(options.useKittyKeyboard).toBeNull()
    }
  })

  test("maps the advanced profile to the opt-in OpenTUI feature set", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: false,
    })
    const options = createTuiRenderOptionsFromProfile(profile)

    expect(profile.profile).toBe("advanced")
    expect(profile.exitOnCtrlC).toBe(false)
    expect(profile.allowTerminalTitle).toBe(true)
    expect(options.exitOnCtrlC).toBe(false)
    expect(options.useThread).toBe(true)
    expect(options.useMouse).toBe(true)
    expect(options.screenMode).toBe("alternate-screen")
    expect(options.useKittyKeyboard).toEqual({})
  })

  test("writes the title OSC escape to stdout in both profiles unless disabled", () => {
    const compatible = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    const { writes, stream } = captureStream()
    expect(setTuiTerminalTitle("ax-code", compatible, stream)).toBe(true)
    expect(clearTuiTerminalTitle(compatible, stream)).toBe(true)
    expect(writes).toEqual(["\x1b]0;ax-code\x07", TITLE_CLEAR_SEQUENCE])

    const advanced = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: false,
    })
    const second = captureStream()
    expect(setTuiTerminalTitle("ax-code", advanced, second.stream)).toBe(true)
    expect(second.writes).toEqual(["\x1b]0;ax-code\x07"])

    for (const advancedTerminal of [false, true]) {
      const disabled = resolveTuiRenderProfile({
        advancedTerminal,
        terminalTitleDisabled: true,
      })
      const third = captureStream()
      expect(setTuiTerminalTitle("ax-code", disabled, third.stream)).toBe(false)
      expect(clearTuiTerminalTitle(disabled, third.stream)).toBe(false)
      expect(third.writes).toEqual([])
    }
  })

  test("sanitizes control characters out of terminal titles", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    const { writes, stream } = captureStream()
    setTuiTerminalTitle("ax-code\x07 |\x1b evil\n", profile, stream)
    expect(writes).toEqual(["\x1b]0;ax-code  |  evil \x07"])
    // C1 controls (\x80-\x9f, e.g. \x9b CSI) must go too — some terminals
    // still honor them, which would break out of the OSC sequence.
    setTuiTerminalTitle("a\x9bb\x80c", profile, stream)
    expect(writes.at(-1)).toBe("\x1b]0;a b c\x07")
  })

  test("title writes are best-effort when stdout is degraded", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    expect(setTuiTerminalTitle("ax-code", profile, { writable: false, write: () => true })).toBe(false)
    expect(
      setTuiTerminalTitle("ax-code", profile, {
        write() {
          throw new Error("broken stdout")
        },
      }),
    ).toBe(false)
  })

  test("skips OSC writes when stdout is not a TTY", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    // Piped/redirected stdout: escape bytes would pollute the redirected
    // output, so an explicit isTTY false must suppress the write.
    const piped = captureStream()
    expect(setTuiTerminalTitle("ax-code", profile, { ...piped.stream, isTTY: false })).toBe(false)
    expect(piped.writes).toEqual([])

    // isTTY undefined (test fakes, some real contexts) and true still write.
    const fake = captureStream()
    expect(setTuiTerminalTitle("ax-code", profile, fake.stream)).toBe(true)
    expect(fake.writes).toEqual(["\x1b]0;ax-code\x07"])
    const tty = captureStream()
    expect(setTuiTerminalTitle("ax-code", profile, { ...tty.stream, isTTY: true })).toBe(true)
    expect(tty.writes).toEqual(["\x1b]0;ax-code\x07"])
  })

  test("detects terminal progress support from the environment", () => {
    expect(supportsTuiTerminalProgress({ WT_SESSION: "abc" })).toBe(true)
    expect(supportsTuiTerminalProgress({ ConEmuANSI: "ON" })).toBe(true)
    expect(supportsTuiTerminalProgress({ TERM_PROGRAM: "ghostty" })).toBe(true)
    expect(supportsTuiTerminalProgress({ TERM_PROGRAM: "WezTerm" })).toBe(true)
    expect(supportsTuiTerminalProgress({ TERM: "xterm-ghostty" })).toBe(true)
    expect(supportsTuiTerminalProgress({ TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" })).toBe(false)
    expect(supportsTuiTerminalProgress({ TERM_PROGRAM: "Apple_Terminal" })).toBe(false)
    expect(supportsTuiTerminalProgress({})).toBe(false)
  })

  test("only animates the fallback title spinner when title output is active", () => {
    const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: false })
    const enabled = {
      profile,
      terminalTitleEnabled: true,
      terminalProgressSupported: false,
      sessionWorking: true,
    }
    expect(shouldAnimateTuiTitleSpinner(enabled)).toBe(true)
    expect(shouldAnimateTuiTitleSpinner({ ...enabled, terminalTitleEnabled: false })).toBe(false)
    expect(shouldAnimateTuiTitleSpinner({ ...enabled, terminalProgressSupported: true })).toBe(false)
    expect(shouldAnimateTuiTitleSpinner({ ...enabled, sessionWorking: false })).toBe(false)
    expect(
      shouldAnimateTuiTitleSpinner({
        ...enabled,
        profile: resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: true }),
      }),
    ).toBe(false)
  })

  describe("terminal progress", () => {
    beforeEach(() => {
      // The support gate defaults to reading process.env; force a supported
      // terminal so the existing activation tests are host-env independent.
      vi.stubEnv("WT_SESSION", "ax-code-test")
    })

    afterEach(() => {
      // Reset module state so the active/inactive dedupe does not leak
      // between tests.
      setTuiTerminalProgress(
        false,
        resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: false }),
        {
          writable: true,
          write: () => true,
        },
      )
      vi.useRealTimers()
      vi.unstubAllEnvs()
    })

    test("writes the active sequence once and re-arms it on a keepalive interval", () => {
      vi.useFakeTimers()
      const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: false })
      const { writes, stream } = captureStream()

      expect(setTuiTerminalProgress(true, profile, stream)).toBe(true)
      // Idempotent while active.
      expect(setTuiTerminalProgress(true, profile, stream)).toBe(false)
      expect(writes).toEqual([TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE])

      vi.advanceTimersByTime(TUI_TERMINAL_PROGRESS_KEEPALIVE_MS * 2)
      expect(writes).toEqual([
        TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE,
        TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE,
        TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE,
      ])

      expect(setTuiTerminalProgress(false, profile, stream)).toBe(true)
      expect(writes.at(-1)).toBe(TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE)
      // No more keepalives after clearing.
      vi.advanceTimersByTime(TUI_TERMINAL_PROGRESS_KEEPALIVE_MS * 3)
      expect(writes.at(-1)).toBe(TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE)
      // Clearing while already cleared is a no-op.
      expect(setTuiTerminalProgress(false, profile, stream)).toBe(false)
    })

    test("does nothing when terminal title support is disabled", () => {
      const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: true })
      const { writes, stream } = captureStream()
      expect(setTuiTerminalProgress(true, profile, stream)).toBe(false)
      expect(writes).toEqual([])
    })

    test("emits nothing when the terminal lacks OSC 9;4 support", () => {
      // iTerm2/kitty parse plain OSC 9;<text> as a desktop notification, so
      // the 9;4 activation sequence and its 1s keepalive must never reach
      // them (the braille title spinner fallback covers those terminals).
      vi.stubEnv("WT_SESSION", "")
      vi.stubEnv("ConEmuANSI", "")
      vi.stubEnv("TERM_PROGRAM", "iTerm.app")
      vi.stubEnv("TERM", "xterm-256color")
      const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: false })
      const { writes, stream } = captureStream()

      expect(setTuiTerminalProgress(true, profile, stream)).toBe(false)
      expect(writes).toEqual([])

      // The unsupported attempt must not latch the dedupe flag — a later
      // supported activation (explicit override) still writes.
      expect(setTuiTerminalProgress(true, profile, stream, true)).toBe(true)
      expect(writes).toEqual([TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE])
    })

    test("a non-TTY stdout fails activation and rolls back to inactive", () => {
      vi.useFakeTimers()
      const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: false })
      const piped = captureStream()
      expect(setTuiTerminalProgress(true, profile, { ...piped.stream, isTTY: false })).toBe(false)
      expect(piped.writes).toEqual([])
      // The write never reached a terminal, so no keepalive may be running.
      vi.advanceTimersByTime(TUI_TERMINAL_PROGRESS_KEEPALIVE_MS * 3)

      // The dedupe flag rolled back, so a later activation retries the write.
      const { writes, stream } = captureStream()
      expect(setTuiTerminalProgress(true, profile, stream)).toBe(true)
      expect(writes).toEqual([TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE])
    })

    test("a failed activation write does not latch the dedupe flag or start the keepalive", () => {
      vi.useFakeTimers()
      const profile = resolveTuiRenderProfile({ advancedTerminal: false, terminalTitleDisabled: false })
      const broken = {
        writable: true,
        write() {
          throw new Error("broken stdout")
        },
      }

      expect(setTuiTerminalProgress(true, profile, broken)).toBe(false)
      // Nothing was ever shown, so no keepalive may be running.
      vi.advanceTimersByTime(TUI_TERMINAL_PROGRESS_KEEPALIVE_MS * 3)

      // A later activation after stdout recovers must retry the write instead
      // of being swallowed by a latched "active" dedupe flag.
      const { writes, stream } = captureStream()
      expect(setTuiTerminalProgress(true, profile, stream)).toBe(true)
      expect(writes).toEqual([TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE])
    })
  })

  test("writes mouse-disable sequences before flushing terminal output", async () => {
    const writes: string[] = []
    const stream = {
      writable: true,
      write(chunk: string, callback?: () => void) {
        writes.push(chunk)
        if (callback) queueMicrotask(callback)
        return true
      },
    }

    expect(disableTuiMouseTracking(stream)).toBe(true)
    await flushTuiStdout(stream)

    expect(writes).toEqual([TUI_MOUSE_TRACKING_DISABLE_SEQUENCE, ""])
  })

  test("terminal cleanup writes are best-effort when stdout is degraded", async () => {
    const stream = {
      writable: true,
      write() {
        throw new Error("broken stdout")
      },
    }

    expect(disableTuiMouseTracking(stream)).toBe(false)
    expect(clearTuiMainScreen(stream)).toBe(false)
    await expect(flushTuiStdout(stream)).resolves.toBeUndefined()
  })

  test("crash cleanup disables terminal modes, clears progress, and resets raw input best-effort", () => {
    const writes: string[] = []
    const rawModes: boolean[] = []

    const restored = resetTuiTerminalState({
      // Alternate-screen mode: leaving the alt screen restores the shell view,
      // so the crash reset emits only the mode-reset sequence. Main-screen
      // clearing is covered in terminal-cleanup.test.ts.
      screenMode: "alternate-screen",
      stdout: {
        writable: true,
        write(chunk: string) {
          writes.push(chunk)
          return true
        },
      },
      stdin: {
        isTTY: true,
        setRawMode(mode: boolean) {
          rawModes.push(mode)
        },
      },
    })

    expect(restored).toBe(true)
    expect(rawModes).toEqual([false])
    expect(writes).toEqual([TUI_TERMINAL_CRASH_RESET_SEQUENCE])
    // A lingering OSC 9;4 indicator would keep animating on a dead tab.
    expect(TUI_TERMINAL_CRASH_RESET_SEQUENCE).toContain(TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE)
  })

  test("destroyTuiRenderer resets terminal state before resolving", async () => {
    const calls: string[] = []
    const renderer = {
      destroy() {
        calls.push("destroy")
      },
    }
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string, callback?: () => void) => {
      calls.push(chunk === "" ? "flush" : chunk === TITLE_CLEAR_SEQUENCE ? "title-clear" : "mouse-disable")
      if (callback) queueMicrotask(callback)
      return true
    }) as typeof process.stdout.write
    try {
      const profile = resolveTuiRenderProfile({
        advancedTerminal: true,
        terminalTitleDisabled: false,
      })
      await destroyTuiRenderer(renderer, profile)
    } finally {
      process.stdout.write = originalWrite
    }

    expect(calls).toEqual(["title-clear", "destroy", "mouse-disable", "flush"])
  })

  test("destroyTuiRenderer clears active terminal progress on teardown", async () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: false,
    })
    const writes: string[] = []
    const stream = {
      writable: true,
      write(chunk: string) {
        writes.push(chunk)
        return true
      },
    }
    setTuiTerminalProgress(true, profile, stream, true)

    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string, callback?: () => void) => {
      writes.push(chunk)
      if (callback) queueMicrotask(callback)
      return true
    }) as typeof process.stdout.write
    try {
      await destroyTuiRenderer({ destroy() {} }, profile)
    } finally {
      process.stdout.write = originalWrite
    }

    expect(writes[0]).toBe(TUI_TERMINAL_PROGRESS_ACTIVE_SEQUENCE)
    expect(writes[1]).toBe(TUI_TERMINAL_PROGRESS_CLEAR_SEQUENCE)
    expect(writes[2]).toBe(TITLE_CLEAR_SEQUENCE)
  })

  test("destroyTuiRenderer clears the stale frame in main-screen mode", async () => {
    const renderer = {
      destroy() {},
    }
    const writes: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string, callback?: () => void) => {
      writes.push(chunk)
      if (callback) queueMicrotask(callback)
      return true
    }) as typeof process.stdout.write
    try {
      const profile = resolveTuiRenderProfile({
        advancedTerminal: false,
        terminalTitleDisabled: false,
      })
      expect(profile.screenMode).toBe("main-screen")
      await destroyTuiRenderer(renderer, profile)
    } finally {
      process.stdout.write = originalWrite
    }

    // Main-screen teardown must emit the clear sequence after disabling mouse
    // tracking and before the final flush, with the title cleared first.
    expect(writes).toEqual([
      TITLE_CLEAR_SEQUENCE,
      TUI_MOUSE_TRACKING_DISABLE_SEQUENCE,
      TUI_MAIN_SCREEN_CLEAR_SEQUENCE,
      "",
    ])
  })

  test("destroyTuiRenderer leaves alternate-screen teardown unchanged", async () => {
    const renderer = {
      destroy() {},
    }
    const writes: string[] = []
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string, callback?: () => void) => {
      writes.push(chunk)
      if (callback) queueMicrotask(callback)
      return true
    }) as typeof process.stdout.write
    try {
      const profile = resolveTuiRenderProfile({
        advancedTerminal: true,
        terminalTitleDisabled: false,
      })
      await destroyTuiRenderer(renderer, profile)
    } finally {
      process.stdout.write = originalWrite
    }

    // Alternate-screen restores the prior view automatically, so no clear.
    expect(writes).not.toContain(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  })

  test("destroyTuiRenderer continues cleanup when stdout is degraded", async () => {
    const calls: string[] = []
    const renderer = {
      destroy() {
        calls.push("destroy")
      },
    }
    const originalWrite = process.stdout.write
    process.stdout.write = (() => {
      throw new Error("broken stdout")
    }) as typeof process.stdout.write
    try {
      const profile = resolveTuiRenderProfile({
        advancedTerminal: false,
        terminalTitleDisabled: false,
      })
      await expect(destroyTuiRenderer(renderer, profile)).resolves.toBeUndefined()
    } finally {
      process.stdout.write = originalWrite
    }

    expect(calls).toEqual(["destroy"])
  })

  test("destroyTuiRenderer preserves renderer destroy errors after terminal cleanup", async () => {
    const calls: string[] = []
    const destroyError = new Error("destroy failed")
    const renderer = {
      destroy() {
        calls.push("destroy")
        throw destroyError
      },
    }
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string, callback?: () => void) => {
      calls.push(
        chunk === ""
          ? "flush"
          : chunk === TITLE_CLEAR_SEQUENCE
            ? "title-clear"
            : chunk === TUI_MAIN_SCREEN_CLEAR_SEQUENCE
              ? "clear"
              : "mouse-disable",
      )
      if (callback) queueMicrotask(callback)
      return true
    }) as typeof process.stdout.write
    try {
      const profile = resolveTuiRenderProfile({
        advancedTerminal: false,
        terminalTitleDisabled: false,
      })
      await expect(destroyTuiRenderer(renderer, profile)).rejects.toBe(destroyError)
    } finally {
      process.stdout.write = originalWrite
    }

    expect(calls).toEqual(["title-clear", "destroy", "mouse-disable", "clear", "flush"])
  })
})
