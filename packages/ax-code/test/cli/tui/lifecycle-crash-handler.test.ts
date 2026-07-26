import { describe, expect, test, vi, beforeEach, afterEach } from "vitest"

// Mock terminal cleanup so tests do not touch the real TTY.
vi.mock("../../../src/cli/cmd/tui/terminal-cleanup", () => ({
  resetTuiTerminalState: vi.fn(),
  flushTuiStdout: vi.fn(async () => undefined),
}))

import { createTuiCrashHandler, createTuiRejectionHandler, registerTuiCrashHandlers } from "../../../src/cli/cmd/tui/util/lifecycle"
import { resetTuiTerminalState, flushTuiStdout } from "../../../src/cli/cmd/tui/terminal-cleanup"

describe("createTuiCrashHandler", () => {
  const originalExitCode = process.exitCode

  beforeEach(() => {
    process.exitCode = undefined
    vi.mocked(resetTuiTerminalState).mockClear()
    vi.mocked(flushTuiStdout).mockClear()
  })

  afterEach(() => {
    process.exitCode = originalExitCode
  })

  test("ignores AbortError without resetting terminal or exiting", () => {
    const onError = vi.fn()
    const handler = createTuiCrashHandler({ onError })
    const abort = new DOMException("Aborted", "AbortError")
    handler(abort)
    expect(onError).not.toHaveBeenCalled()
    expect(resetTuiTerminalState).not.toHaveBeenCalled()
    expect(flushTuiStdout).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  test("treats real errors as fatal", async () => {
    const onError = vi.fn()
    const handler = createTuiCrashHandler({ onError })
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    try {
      handler(new Error("boom"))
      expect(onError).toHaveBeenCalled()
      expect(resetTuiTerminalState).toHaveBeenCalled()
      expect(process.exitCode).toBe(1)
      // flushTuiStdout finally path may call exit asynchronously
      await Promise.resolve()
      await Promise.resolve()
      expect(flushTuiStdout).toHaveBeenCalled()
    } finally {
      exitSpy.mockRestore()
    }
  })
})

describe("createTuiRejectionHandler", () => {
  beforeEach(() => {
    process.exitCode = undefined
    vi.mocked(resetTuiTerminalState).mockClear()
    vi.mocked(flushTuiStdout).mockClear()
  })

  test("logs and continues without resetting the terminal or exiting", () => {
    const onError = vi.fn()
    const handler = createTuiRejectionHandler({ onError })
    handler(new Error("dropped promise"))
    expect(onError).toHaveBeenCalled()
    expect(resetTuiTerminalState).not.toHaveBeenCalled()
    expect(flushTuiStdout).not.toHaveBeenCalled()
    expect(process.exitCode).toBeUndefined()
  })

  test("ignores harmless interrupts", () => {
    const onError = vi.fn()
    const handler = createTuiRejectionHandler({ onError })
    handler(new DOMException("Aborted", "AbortError"))
    expect(onError).not.toHaveBeenCalled()
  })
})

describe("registerTuiCrashHandlers", () => {
  test("uncaughtException stays fatal while unhandledRejection gets the non-fatal default", () => {
    const fatal = vi.fn()
    const unregister = registerTuiCrashHandlers(fatal, { namePrefix: "test" })
    try {
      expect(process.listeners("uncaughtException")).toContain(fatal)
      expect(process.listeners("unhandledRejection")).not.toContain(fatal)
    } finally {
      unregister()
    }
    expect(process.listeners("uncaughtException")).not.toContain(fatal)
  })

  test("uses the caller-provided onRejection when given", () => {
    const onRejection = vi.fn()
    const unregister = registerTuiCrashHandlers(vi.fn(), { namePrefix: "test", onRejection })
    try {
      expect(process.listeners("unhandledRejection")).toContain(onRejection)
    } finally {
      unregister()
    }
    expect(process.listeners("unhandledRejection")).not.toContain(onRejection)
  })
})
