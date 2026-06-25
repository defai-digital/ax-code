import { describe, expect, test } from "vitest"
import {
  clearTuiTerminalTitle,
  createTuiRenderOptionsFromProfile,
  destroyTuiRenderer,
  resolveTuiRenderProfile,
  setTuiTerminalTitle,
} from "../../../src/cli/cmd/tui/renderer"
import {
  disableTuiMouseTracking,
  flushTuiStdout,
  TUI_MAIN_SCREEN_CLEAR_SEQUENCE,
  TUI_MOUSE_TRACKING_DISABLE_SEQUENCE,
} from "../../../src/cli/cmd/tui/terminal-cleanup"

describe("tui renderer profile", () => {
  test("keeps the compatibility profile production-safe", () => {
    const profile = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    const options = createTuiRenderOptionsFromProfile(profile)

    expect(profile.profile).toBe("compatible")
    expect(profile.exitOnCtrlC).toBe(false)
    expect(profile.allowTerminalTitle).toBe(false)
    expect(options.exitOnCtrlC).toBe(false)
    expect(options.useThread).toBe(false)
    expect(options.useMouse).toBe(true)
    expect(options.screenMode).toBe("main-screen")
    expect(options.useKittyKeyboard).toBeNull()
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

  test("only writes terminal titles when the profile explicitly allows it", () => {
    const calls: string[] = []
    const renderer = {
      setTerminalTitle(title: string) {
        calls.push(title)
      },
    }

    const compatible = resolveTuiRenderProfile({
      advancedTerminal: false,
      terminalTitleDisabled: false,
    })
    expect(setTuiTerminalTitle(renderer, "ax-code", compatible)).toBe(false)
    expect(clearTuiTerminalTitle(renderer, compatible)).toBe(false)

    const advancedDisabled = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: true,
    })
    expect(setTuiTerminalTitle(renderer, "ax-code", advancedDisabled)).toBe(false)

    const advanced = resolveTuiRenderProfile({
      advancedTerminal: true,
      terminalTitleDisabled: false,
    })
    expect(setTuiTerminalTitle(renderer, "ax-code", advanced)).toBe(true)
    expect(clearTuiTerminalTitle(renderer, advanced)).toBe(true)
    expect(calls).toEqual(["ax-code", ""])
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

  test("destroyTuiRenderer resets terminal state before resolving", async () => {
    const calls: string[] = []
    const renderer = {
      setTerminalTitle(title: string) {
        calls.push(`title:${title}`)
      },
      destroy() {
        calls.push("destroy")
      },
    }
    const originalWrite = process.stdout.write
    process.stdout.write = ((chunk: string, callback?: () => void) => {
      calls.push(chunk === "" ? "flush" : "mouse-disable")
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

    expect(calls).toEqual(["title:", "destroy", "mouse-disable", "flush"])
  })

  test("destroyTuiRenderer clears the stale frame in main-screen mode", async () => {
    const renderer = {
      setTerminalTitle() {},
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
    // tracking and before the final flush.
    expect(writes).toEqual([TUI_MOUSE_TRACKING_DISABLE_SEQUENCE, TUI_MAIN_SCREEN_CLEAR_SEQUENCE, ""])
  })

  test("destroyTuiRenderer leaves alternate-screen teardown unchanged", async () => {
    const renderer = {
      setTerminalTitle() {},
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
})
