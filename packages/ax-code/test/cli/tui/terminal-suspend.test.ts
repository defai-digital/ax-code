import { describe, expect, test, vi } from "vitest"
import { createTerminalSuspendController } from "../../../src/cli/cmd/tui/util/terminal-suspend"

describe("createTerminalSuspendController", () => {
  test("registers SIGCONT, suspends, and sends stop", () => {
    const handlers = new Map<string | symbol, Set<(...args: unknown[]) => void>>()
    const registerProcessHandler = vi.fn(
      (event: string | symbol, handler: (...args: unknown[]) => void, _input: { name: string }) => {
        const set = handlers.get(event) ?? new Set()
        set.add(handler)
        handlers.set(event, set)
        return () => {
          set.delete(handler)
        }
      },
    )
    const sendStop = vi.fn()
    const suspend = vi.fn()
    const resume = vi.fn()

    const controller = createTerminalSuspendController({
      registerProcessHandler,
      sendStop,
    })

    controller.suspend({ suspend, resume })

    expect(suspend).toHaveBeenCalledTimes(1)
    expect(sendStop).toHaveBeenCalledTimes(1)
    expect(registerProcessHandler).toHaveBeenCalledWith("SIGCONT", expect.any(Function), {
      name: "terminal-suspend-sigcont",
      logger: expect.anything(),
    })
    expect(handlers.get("SIGCONT")?.size).toBe(1)

    // Simulate shell continuing the process group.
    for (const handler of handlers.get("SIGCONT") ?? []) handler()
    expect(resume).toHaveBeenCalledTimes(1)
    expect(handlers.get("SIGCONT")?.size).toBe(0)
  })

  test("dispose removes a pending SIGCONT handler without resuming", () => {
    const handlers = new Map<string | symbol, Set<(...args: unknown[]) => void>>()
    const registerProcessHandler = (
      event: string | symbol,
      handler: (...args: unknown[]) => void,
      _input: { name: string },
    ) => {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return () => {
        set.delete(handler)
      }
    }

    const controller = createTerminalSuspendController({
      registerProcessHandler,
      sendStop: () => {},
    })
    const resume = vi.fn()
    controller.suspend({ suspend: () => {}, resume })
    expect(handlers.get("SIGCONT")?.size).toBe(1)

    controller.dispose()
    expect(handlers.get("SIGCONT")?.size).toBe(0)
    expect(resume).not.toHaveBeenCalled()
  })

  test("re-suspend replaces the previous SIGCONT handler", () => {
    const handlers = new Map<string | symbol, Set<(...args: unknown[]) => void>>()
    const registerProcessHandler = (
      event: string | symbol,
      handler: (...args: unknown[]) => void,
      _input: { name: string },
    ) => {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return () => {
        set.delete(handler)
      }
    }

    const controller = createTerminalSuspendController({
      registerProcessHandler,
      sendStop: () => {},
    })
    const firstResume = vi.fn()
    const secondResume = vi.fn()

    controller.suspend({ suspend: () => {}, resume: firstResume })
    controller.suspend({ suspend: () => {}, resume: secondResume })
    expect(handlers.get("SIGCONT")?.size).toBe(1)

    for (const handler of handlers.get("SIGCONT") ?? []) handler()
    expect(firstResume).not.toHaveBeenCalled()
    expect(secondResume).toHaveBeenCalledTimes(1)
  })

  test("swallows resume errors instead of throwing into the signal path", () => {
    const handlers = new Map<string | symbol, Set<(...args: unknown[]) => void>>()
    const registerProcessHandler = (
      event: string | symbol,
      handler: (...args: unknown[]) => void,
      _input: { name: string },
    ) => {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return () => {
        set.delete(handler)
      }
    }
    const logger = { warn: vi.fn() }

    const controller = createTerminalSuspendController({
      registerProcessHandler,
      sendStop: () => {},
      logger,
    })
    controller.suspend({
      suspend: () => {},
      resume: () => {
        throw new Error("resume boom")
      },
    })

    expect(() => {
      for (const handler of handlers.get("SIGCONT") ?? []) handler()
    }).not.toThrow()
    expect(logger.warn).toHaveBeenCalledWith(
      "tui terminal resume failed",
      expect.objectContaining({ error: expect.any(Error) }),
    )
  })

  test("resumes and disposes when sendStop fails", () => {
    const handlers = new Map<string | symbol, Set<(...args: unknown[]) => void>>()
    const registerProcessHandler = (
      event: string | symbol,
      handler: (...args: unknown[]) => void,
      _input: { name: string },
    ) => {
      const set = handlers.get(event) ?? new Set()
      set.add(handler)
      handlers.set(event, set)
      return () => {
        set.delete(handler)
      }
    }
    const logger = { warn: vi.fn() }
    const resume = vi.fn()

    const controller = createTerminalSuspendController({
      registerProcessHandler,
      sendStop: () => {
        throw new Error("stop failed")
      },
      logger,
    })
    controller.suspend({ suspend: () => {}, resume })

    expect(resume).toHaveBeenCalledTimes(1)
    expect(handlers.get("SIGCONT")?.size ?? 0).toBe(0)
    expect(logger.warn).toHaveBeenCalledWith(
      "tui terminal stop signal failed",
      expect.objectContaining({ error: expect.any(Error) }),
    )
  })
})
