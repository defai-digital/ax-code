import { beforeEach, describe, expect, test } from "vitest"

import { createAudioNotifier, MAX_FIRED_KEYS as AUDIO_MAX_FIRED_KEYS } from "../../../src/cli/tui/util/audio-notify"
import {
  MAX_FIRED_KEYS as TERMINAL_MAX_FIRED_KEYS,
  notifyTerminal,
  resetTerminalNotificationKeys,
} from "../../../src/cli/tui/util/terminal-notify"

const supportedEnv = { TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" }
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => {
  resetTerminalNotificationKeys()
})

describe("terminal notification fired keys cap", () => {
  test("keeps fire-once for recent keys and evicts the oldest beyond the cap", () => {
    const writes: string[] = []
    const stream = {
      writable: true,
      isTTY: true,
      destroyed: false,
      write: (chunk: string) => {
        writes.push(chunk)
        return true
      },
    }
    const cap = TERMINAL_MAX_FIRED_KEYS
    expect(cap).toBeGreaterThan(0)

    for (let i = 0; i <= cap; i++) {
      expect(notifyTerminal({ title: "ax-code", body: "done", key: `turn:${i}` }, stream, supportedEnv)).toBe(true)
    }
    expect(writes).toHaveLength(cap + 1)

    // Recent keys are still fire-once.
    expect(notifyTerminal({ title: "ax-code", body: "done", key: `turn:${cap}` }, stream, supportedEnv)).toBe(false)
    expect(notifyTerminal({ title: "ax-code", body: "done", key: "turn:1" }, stream, supportedEnv)).toBe(false)
    expect(writes).toHaveLength(cap + 1)

    // The oldest key was evicted, so it may fire again.
    expect(notifyTerminal({ title: "ax-code", body: "done", key: "turn:0" }, stream, supportedEnv)).toBe(true)
    expect(writes).toHaveLength(cap + 2)
  })
})

describe("audio notification fired keys cap", () => {
  test("keeps fire-once for recent keys and evicts the oldest beyond the cap", async () => {
    const calls: string[][] = []
    let now = 1_000_000
    const instance = createAudioNotifier({
      spawn: (cmd) => {
        calls.push([...cmd])
        return { exited: Promise.resolve(0) }
      },
      platform: "darwin",
      which: (cmd) => (cmd === "afplay" ? "/usr/bin/afplay" : null),
      fileExists: (path) => path === "/System/Library/Sounds/Glass.aiff",
      // Jump past the minimum play gap on every read so plays never sleep.
      now: () => (now += 3_000),
      setTimeout: (fn) => fn(),
    })
    const settings = { enabled: true, sound: "chime" } as const
    const cap = AUDIO_MAX_FIRED_KEYS
    expect(cap).toBe(TERMINAL_MAX_FIRED_KEYS)

    for (let i = 0; i <= cap; i++) {
      instance.notify({ kind: "permission", source: "bash", settings, key: `permission:${i}` })
      await flush()
    }
    expect(calls).toHaveLength(cap + 1)

    instance.notify({ kind: "permission", source: "bash", settings, key: `permission:${cap}` })
    instance.notify({ kind: "permission", source: "bash", settings, key: "permission:1" })
    await flush()
    expect(calls).toHaveLength(cap + 1)

    instance.notify({ kind: "permission", source: "bash", settings, key: "permission:0" })
    await flush()
    expect(calls).toHaveLength(cap + 2)
  })
})
