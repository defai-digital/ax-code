import { afterEach, describe, expect, test, vi } from "vitest"

// Regression coverage for the macOS large-copy bug: the old implementation
// passed the whole text as a single `osascript` argv element, so copies over
// ARG_MAX (~1 MiB) failed the spawn with E2BIG while `nothrow`+`copy()`'s
// blanket catch swallowed the error and callers toasted success. The fix
// pipes through `pbcopy` stdin, surfaces non-zero exits, and only swallows
// system-tool failures when OSC52 actually emitted a clipboard write.

const clipboardState = vi.hoisted(() => ({
  exitCode: 0,
  spawnCalls: [] as { cmd: string[]; writes: string[]; ended: boolean }[],
  runCalls: [] as string[][],
}))

vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("os")>()
  return { ...actual, platform: () => "darwin" as NodeJS.Platform }
})

vi.mock("@/util/which", () => ({ which: (cmd: string) => `/usr/bin/${cmd}` }))

vi.mock("@/util/process", () => ({
  Process: {
    spawn: (cmd: string[]) => {
      const call = { cmd, writes: [] as string[], ended: false }
      clipboardState.spawnCalls.push(call)
      return {
        stdin: {
          write(chunk: unknown) {
            call.writes.push(String(chunk))
            return true
          },
          end() {
            call.ended = true
          },
          once() {},
          off() {},
        },
        exited: Promise.resolve(clipboardState.exitCode),
        pid: 42,
        kill: () => true,
        exitCode: clipboardState.exitCode,
        signalCode: null,
      }
    },
    run: async (cmd: string[]) => {
      clipboardState.runCalls.push(cmd)
      return { code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }
    },
    text: async () => ({ code: 0, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0), text: "" }),
    killProcessTree: async () => {},
  },
}))

import { Clipboard } from "@tui/util/clipboard"

const originalTtyDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY")

function setTty(value: boolean) {
  Object.defineProperty(process.stdout, "isTTY", { value, configurable: true })
}

afterEach(() => {
  if (originalTtyDescriptor) Object.defineProperty(process.stdout, "isTTY", originalTtyDescriptor)
  else delete (process.stdout as unknown as Record<string, unknown>).isTTY
  vi.restoreAllMocks()
  clipboardState.exitCode = 0
  clipboardState.spawnCalls.length = 0
  clipboardState.runCalls.length = 0
})

describe("macOS Clipboard.copy", () => {
  test("pipes text to pbcopy via stdin instead of an osascript argv element", async () => {
    setTty(false)
    await Clipboard.copy("hello clipboard")

    expect(clipboardState.runCalls).toEqual([])
    const call = clipboardState.spawnCalls.at(-1)
    expect(call?.cmd).toEqual(["pbcopy"])
    expect(call?.writes.join("")).toBe("hello clipboard")
    expect(call?.ended).toBe(true)
  })

  test("rejects on clipboard-tool failure when OSC52 could not emit (no TTY)", async () => {
    setTty(false)
    clipboardState.exitCode = 1
    await expect(Clipboard.copy("some text")).rejects.toThrow(/exited with code 1/)
  })

  test("rejects on clipboard-tool failure when the payload exceeds the OSC52 limit", async () => {
    setTty(true)
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    clipboardState.exitCode = 1

    await expect(Clipboard.copy("x".repeat(200_000))).rejects.toThrow(/exited with code 1/)
    // OSC52 must have bailed: no ]52; escape emitted for the oversized payload.
    expect(write.mock.calls.some((args) => String(args[0]).includes("]52;"))).toBe(false)
  })

  test("swallows clipboard-tool failure when OSC52 already emitted the write", async () => {
    setTty(true)
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true)
    clipboardState.exitCode = 1

    await expect(Clipboard.copy("small text")).resolves.toBeUndefined()
    expect(write.mock.calls.some((args) => String(args[0]).includes("]52;"))).toBe(true)
  })
})
