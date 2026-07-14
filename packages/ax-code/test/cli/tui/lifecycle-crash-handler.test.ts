import { describe, expect, test, vi, beforeEach, afterEach } from "vitest"

// Mock terminal cleanup so tests do not touch the real TTY.
vi.mock("../../../src/cli/cmd/tui/terminal-cleanup", () => ({
  resetTuiTerminalState: vi.fn(),
  flushTuiStdout: vi.fn(async () => undefined),
}))

import { createTuiCrashHandler } from "../../../src/cli/cmd/tui/util/lifecycle"
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
