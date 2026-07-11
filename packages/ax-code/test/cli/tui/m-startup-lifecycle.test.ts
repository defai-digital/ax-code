import { describe, expect, test, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"
import { createTuiCrashHandler, registerTuiCrashHandlers } from "../../../src/cli/cmd/tui/util/lifecycle"

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "../../..")
const THREAD_SRC = readFileSync(path.join(PACKAGE_ROOT, "src/cli/cmd/tui/thread.ts"), "utf8")
const WORKER_SRC = readFileSync(path.join(PACKAGE_ROOT, "src/cli/cmd/tui/worker.ts"), "utf8")

describe("tui crash handler", () => {
  test("restores the terminal, records the error, and exits non-zero", async () => {
    vi.useFakeTimers()
    const prevExitCode = process.exitCode
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, cb?: unknown) => {
      if (typeof cb === "function") (cb as () => void)()
      return true
    }) as typeof process.stdout.write)
    try {
      const onError = vi.fn()
      const handler = createTuiCrashHandler({ onError })
      const err = new Error("kaboom")
      handler(err)

      expect(onError).toHaveBeenCalledWith(err)
      expect(process.exitCode).toBe(1)
      // Emitted the crash reset sequence (at minimum the cursor-show code).
      const wrote = write.mock.calls.map((c) => String(c[0])).join("")
      expect(wrote).toContain("\x1b[?25h")

      // The scheduled 100ms exit is cleared by the flush path; advance to let
      // the flush-then-exit promise settle.
      await vi.advanceTimersByTimeAsync(600)
      expect(exit).toHaveBeenCalledWith(1)
    } finally {
      exit.mockRestore()
      write.mockRestore()
      vi.useRealTimers()
      process.exitCode = prevExitCode
    }
  })

  test("is idempotent across a second crash event", async () => {
    vi.useFakeTimers()
    const prevExitCode = process.exitCode
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never)
    const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, cb?: unknown) => {
      if (typeof cb === "function") (cb as () => void)()
      return true
    }) as typeof process.stdout.write)
    try {
      const onError = vi.fn()
      const handler = createTuiCrashHandler({ onError })
      handler(new Error("first"))
      // A rejection following the exception must not throw a second time.
      expect(() => handler(new Error("second"))).not.toThrow()
      expect(onError).toHaveBeenCalledTimes(2)
      // The `scheduled` guard means only one exit is queued despite two crashes.
      await vi.advanceTimersByTimeAsync(600)
      expect(exit).toHaveBeenCalledTimes(1)
    } finally {
      exit.mockRestore()
      write.mockRestore()
      vi.useRealTimers()
      process.exitCode = prevExitCode
    }
  })
})

describe("registerTuiCrashHandlers", () => {
  test("registers both fatal process events and unregisters them", () => {
    const before = {
      uncaught: process.listenerCount("uncaughtException"),
      rejection: process.listenerCount("unhandledRejection"),
    }
    const unregister = registerTuiCrashHandlers(vi.fn(), { namePrefix: "test" })
    expect(process.listenerCount("uncaughtException")).toBe(before.uncaught + 1)
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection + 1)
    unregister()
    expect(process.listenerCount("uncaughtException")).toBe(before.uncaught)
    expect(process.listenerCount("unhandledRejection")).toBe(before.rejection)
  })
})

describe("startup/exit source guardrails", () => {
  test("#7: forwards the full process env to the backend, not the secret-stripped view", () => {
    // The backend is a trusted peer; env-provided provider API keys must reach it.
    expect(THREAD_SRC).toContain("const backendEnv: Record<string, string | undefined> = { ...process.env }")
    // The Env helper is no longer imported/used to build the backend env.
    expect(THREAD_SRC).not.toMatch(/import \{ Env \} from/)
  })

  test("#7: worker loads shell env for parity with the process backend", () => {
    expect(WORKER_SRC).toContain("startShellEnvLoad(process.env)")
  })

  test("#36: chdir failure sets a non-zero exit code", () => {
    const idx = THREAD_SRC.indexOf("Failed to change directory")
    expect(idx).toBeGreaterThan(-1)
    // Assert on the chdir catch block specifically (up to the next return).
    const block = THREAD_SRC.slice(idx, THREAD_SRC.indexOf("return", idx) + "return".length)
    expect(block).toContain("process.exitCode = 1")
  })
})
