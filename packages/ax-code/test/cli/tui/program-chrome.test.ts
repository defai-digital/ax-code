import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { CHROME_CLEAR_SEQUENCE } from "@ax-code/akitty-sdk"
import {
  createTuiProgramChrome,
  disposeTuiProgramChrome,
  supportsTuiProgramChrome,
  updateTuiProgramChrome,
} from "../../../src/cli/tui/program-chrome"
import { destroyTuiRenderer, resolveTuiRenderProfile, setTuiProgramChrome } from "../../../src/cli/tui/renderer"
import { createTuiTerminalCrashResetSequence, resetTuiTerminalState } from "../../../src/cli/tui/terminal-cleanup"
import { registerTuiSequenceTarget, unregisterTuiSequenceTarget } from "../../../src/cli/tui/util/sequence-writer"

const busy = { enabled: true, busy: true, animations: true, statusText: "Working" }
const env = { TERM_PROGRAM: "Akitty", TERM: "xterm-256color" }
const profile = resolveTuiRenderProfile({ advancedTerminal: true, terminalTitleDisabled: false })
const parse = (sequence: string) => JSON.parse(sequence.slice("\x1b]771;".length, -1))

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  disposeTuiProgramChrome()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function harness() {
  const writes: string[] = []
  const onError = vi.fn()
  const controller = createTuiProgramChrome({
    supported: true,
    write: (sequence) => {
      writes.push(sequence)
      return true
    },
    onError,
  })
  return { writes, onError, controller }
}

describe("AkiTTY program chrome", () => {
  test("busy sessions show localized status, progress and an A/X sprite while updates deduplicate", () => {
    const { writes, controller } = harness()
    expect(controller.update({ ...busy, statusText: "處理中" })).toBe(true)
    const initial = parse(writes.at(-1)!)
    expect(initial.status).toEqual({ text: "處理中", tone: "info" })
    expect(initial.progress).toBe("indeterminate")
    expect(initial.sprite).toMatchObject({ w: 4, h: 4 })
    expect(initial.sprite.frames).toHaveLength(2)
    expect(initial.mark).toBe(0)
    expect(controller.update({ ...busy, statusText: "處理中" })).toBe(false)
    vi.advanceTimersByTime(250)
    expect(parse(writes.at(-1)!).mark).toBe(1)
    expect(parse(writes.at(-1)!).status.text).toBe("處理中")
    controller.update({ ...busy, statusText: "Retrying" })
    expect(parse(writes.at(-1)!).status.text).toBe("Retrying")
    controller.dispose()
  })

  test("the animation preference switches to frame zero and cancels playback", () => {
    const { writes, controller } = harness()
    controller.update(busy)
    vi.advanceTimersByTime(250)
    controller.update({ ...busy, animations: false })
    expect(parse(writes.at(-1)!).mark).toBe(0)
    const count = writes.length
    vi.advanceTimersByTime(2000)
    expect(writes).toHaveLength(count)
    controller.dispose()
  })

  test.each([{ busy: false }, { enabled: false }])(
    "idle and title opt-out clear chrome and stop timers: %j",
    (change) => {
      const { writes, controller } = harness()
      controller.update(busy)
      controller.update({ ...busy, ...change })
      expect(writes.at(-1)).toBe(CHROME_CLEAR_SEQUENCE)
      const count = writes.length
      vi.advanceTimersByTime(2000)
      expect(writes).toHaveLength(count)
      controller.dispose()
    },
  )

  test("failed animation writes permit an identical subsequent update to retry", () => {
    let failed = false
    const writes: string[] = []
    const controller = createTuiProgramChrome({
      supported: true,
      onError: vi.fn(),
      write: (sequence) => {
        if (failed) return false
        writes.push(sequence)
        return true
      },
    })
    controller.update(busy)
    failed = true
    vi.advanceTimersByTime(250)
    failed = false
    expect(controller.update(busy)).toBe(true)
    vi.advanceTimersByTime(250)
    expect(parse(writes.at(-1)!).mark).toBe(1)
    controller.dispose()
  })

  test("unsupported terminals, non-TTYs, SSH and multiplexers never receive chrome", () => {
    const write = vi.fn(() => true)
    for (const entry of [
      { env, isTTY: false },
      { env: { TERM_PROGRAM: "ghostty" }, isTTY: true },
      { env: { ...env, SSH_TTY: "remote" }, isTTY: true },
      { env: { ...env, TMUX: "outer" }, isTTY: true },
      { env: { TERM_PROGRAM: "vscode", WT_SESSION: "outer" }, isTTY: true },
    ]) {
      expect(supportsTuiProgramChrome(entry.env, entry.isTTY)).toBe(false)
      updateTuiProgramChrome(busy, { ...entry, owner: write, write, onError: vi.fn() })
    }
    vi.advanceTimersByTime(2000)
    expect(write).not.toHaveBeenCalled()
  })

  test("renderer writes and timer ticks use the existing serialized native queue", () => {
    const writes: string[] = []
    const target = {
      threaded: true,
      write: (sequence: string) => {
        writes.push(sequence)
      },
    }
    const original = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")
    Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: true })
    registerTuiSequenceTarget(target)
    try {
      setTuiProgramChrome(busy, profile, process.stdout, env)
      vi.advanceTimersByTime(250)
      expect(writes).toHaveLength(3)
      expect(parse(writes.at(-1)!).mark).toBe(1)
      disposeTuiProgramChrome()
      expect(writes.at(-1)).toBe(CHROME_CLEAR_SEQUENCE)
      const count = writes.length
      vi.advanceTimersByTime(2000)
      expect(writes).toHaveLength(count)
    } finally {
      unregisterTuiSequenceTarget(target)
      if (original) Object.defineProperty(process.stdout, "isTTY", original)
      else delete (process.stdout as { isTTY?: boolean }).isTTY
    }
  })

  test("renderer profile opt-out prevents program chrome", () => {
    const write = vi.fn(() => true)
    const disabled = resolveTuiRenderProfile({ advancedTerminal: true, terminalTitleDisabled: true })
    setTuiProgramChrome(busy, disabled, { isTTY: true, write }, env)
    expect(write).not.toHaveBeenCalled()
  })

  test("renderer teardown clears chrome before destroying the renderer", async () => {
    const calls: string[] = []
    const stream = {
      isTTY: true,
      write: (sequence: string) => {
        calls.push(sequence)
        return true
      },
    }
    setTuiProgramChrome(busy, profile, stream, env)
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: string, callback?: () => void) => {
      callback?.()
      return true
    }) as typeof process.stdout.write)
    try {
      await destroyTuiRenderer(
        {
          destroy: () => {
            calls.push("destroy")
          },
        },
        { ...profile, allowTerminalTitle: false },
      )
    } finally {
      stdout.mockRestore()
    }
    expect(calls).toContain(CHROME_CLEAR_SEQUENCE)
    expect(calls.indexOf(CHROME_CLEAR_SEQUENCE)).toBeLessThan(calls.indexOf("destroy"))
    const count = calls.length
    vi.advanceTimersByTime(2000)
    expect(calls).toHaveLength(count)
  })

  test("crash reset stops active playback and includes a direct OSC clear for native AkiTTY", () => {
    vi.stubEnv("TERM_PROGRAM", "Akitty")
    vi.stubEnv("TERM", "xterm-256color")
    for (const key of [
      "SSH_CONNECTION",
      "SSH_CLIENT",
      "SSH_TTY",
      "MOSH_CONNECTION",
      "TMUX",
      "TMUX_PANE",
      "STY",
      "ZELLIJ",
    ])
      vi.stubEnv(key, "")
    const writes: string[] = []
    const stream = {
      isTTY: true,
      write: (sequence: string) => {
        writes.push(sequence)
        return true
      },
    }
    setTuiProgramChrome(busy, profile, stream, env)
    resetTuiTerminalState({ stdout: stream, stdin: { isTTY: false }, screenMode: "alternate-screen" })
    expect(writes.at(-1)).toContain(CHROME_CLEAR_SEQUENCE)
    expect(createTuiTerminalCrashResetSequence({ programChrome: true })).toContain(CHROME_CLEAR_SEQUENCE)
    const count = writes.length
    vi.advanceTimersByTime(2000)
    expect(writes).toHaveLength(count)
  })
})
