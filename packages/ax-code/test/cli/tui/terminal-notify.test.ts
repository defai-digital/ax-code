import { describe, expect, test, beforeEach } from "vitest"

import {
  notifyTerminal,
  resetTerminalNotificationKeys,
  supportsTerminalNotification,
} from "../../../src/cli/cmd/tui/util/terminal-notify"

function fakeStdout() {
  const writes: string[] = []
  const stream = {
    writable: true as boolean,
    destroyed: false,
    write: (chunk: string) => {
      writes.push(chunk)
      return true
    },
  }
  return { stream, writes }
}

const supportedEnv = { TERM_PROGRAM: "iTerm.app", TERM: "xterm-256color" }
const unsupportedEnv = { TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" }

beforeEach(() => {
  resetTerminalNotificationKeys()
})

describe("supportsTerminalNotification", () => {
  test("allows known TERM_PROGRAM values", () => {
    for (const termProgram of ["iTerm.app", "WezTerm", "ghostty", "WarpTerminal"]) {
      expect(supportsTerminalNotification({ TERM_PROGRAM: termProgram })).toBe(true)
    }
  })

  test("allows known TERM values", () => {
    expect(supportsTerminalNotification({ TERM: "xterm-kitty" })).toBe(true)
    expect(supportsTerminalNotification({ TERM: "xterm-ghostty" })).toBe(true)
  })

  test("rejects unknown terminals", () => {
    expect(supportsTerminalNotification({ TERM_PROGRAM: "Apple_Terminal", TERM: "xterm-256color" })).toBe(false)
    expect(supportsTerminalNotification({})).toBe(false)
  })
})

describe("notifyTerminal", () => {
  test("writes an OSC 9 sequence on supported terminals", () => {
    const { stream, writes } = fakeStdout()
    const result = notifyTerminal({ title: "ax-code", body: "Task complete", key: "k1" }, stream, supportedEnv)
    expect(result).toBe(true)
    expect(writes).toEqual(["\x1b]9;ax-code: Task complete\x07"])
  })

  test("sanitizes control characters and collapses whitespace", () => {
    const { stream, writes } = fakeStdout()
    notifyTerminal({ title: "ax\x07code", body: "line one\n\x1b]8;;evil\x07  done", key: "k2" }, stream, supportedEnv)
    expect(writes).toEqual(["\x1b]9;ax code: line one ]8;;evil done\x07"])
  })

  test("sanitizes C1 control characters (CSI/OSC/ST) that could break out of the payload", () => {
    const { stream, writes } = fakeStdout()
    notifyTerminal({ title: "ax-code", body: "evil\x9d8;;x\x9c tail\x9b0m", key: "k2c1" }, stream, supportedEnv)
    expect(writes).toEqual(["\x1b]9;ax-code: evil 8;;x tail 0m\x07"])
    expect(writes[0]).not.toMatch(/[\x80-\x9f]/)
  })

  test("caps the whole OSC sequence at 240 chars", () => {
    const { stream, writes } = fakeStdout()
    notifyTerminal({ title: "ax-code", body: "x".repeat(500), key: "k3" }, stream, supportedEnv)
    expect(writes[0].length).toBe(240)
    expect(writes[0].startsWith("\x1b]9;ax-code: ")).toBe(true)
    expect(writes[0].endsWith("\x07")).toBe(true)
  })

  test("wraps the sequence in a tmux DCS passthrough with ESC doubled", () => {
    const { stream, writes } = fakeStdout()
    notifyTerminal({ title: "ax-code", body: "Task complete", key: "k4" }, stream, {
      ...supportedEnv,
      TMUX: "/tmp/tmux-1000/default,1234,0",
    })
    expect(writes).toEqual(["\x1bPtmux;\x1b\x1b]9;ax-code: Task complete\x07\x1b\\"])
  })

  test("writes a bare BEL on unsupported terminals", () => {
    const { stream, writes } = fakeStdout()
    const result = notifyTerminal({ title: "ax-code", body: "Task complete", key: "k5" }, stream, unsupportedEnv)
    expect(result).toBe(true)
    expect(writes).toEqual(["\x07"])
  })

  test("fires only once per key", () => {
    const { stream, writes } = fakeStdout()
    expect(notifyTerminal({ title: "ax-code", body: "Task complete", key: "k6" }, stream, supportedEnv)).toBe(true)
    expect(notifyTerminal({ title: "ax-code", body: "Task complete", key: "k6" }, stream, supportedEnv)).toBe(false)
    expect(writes).toHaveLength(1)
  })

  test("resetTerminalNotificationKeys re-arms a key", () => {
    const { stream, writes } = fakeStdout()
    notifyTerminal({ title: "ax-code", body: "Task complete", key: "k7" }, stream, supportedEnv)
    resetTerminalNotificationKeys()
    expect(notifyTerminal({ title: "ax-code", body: "Task complete", key: "k7" }, stream, supportedEnv)).toBe(true)
    expect(writes).toHaveLength(2)
  })

  test("returns false without writing when the stream is not writable", () => {
    const { stream, writes } = fakeStdout()
    stream.writable = false
    expect(notifyTerminal({ title: "ax-code", body: "Task complete", key: "k8" }, stream, supportedEnv)).toBe(false)
    expect(writes).toEqual([])
  })

  test("returns false without writing when the stream is destroyed", () => {
    const { stream, writes } = fakeStdout()
    stream.destroyed = true
    expect(notifyTerminal({ title: "ax-code", body: "Task complete", key: "k9" }, stream, supportedEnv)).toBe(false)
    expect(writes).toEqual([])
  })

  test("returns false without writing when stdout is redirected", () => {
    const { stream, writes } = fakeStdout()
    expect(
      notifyTerminal(
        { title: "ax-code", body: "Task complete", key: "k9-piped" },
        { ...stream, isTTY: false },
        supportedEnv,
      ),
    ).toBe(false)
    expect(writes).toEqual([])
  })

  test("returns false when write throws", () => {
    const stream = {
      write: () => {
        throw new Error("EPIPE")
      },
    }
    expect(notifyTerminal({ title: "ax-code", body: "Task complete", key: "k10" }, stream, supportedEnv)).toBe(false)
  })
})
