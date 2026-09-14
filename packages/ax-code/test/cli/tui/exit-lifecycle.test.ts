import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createRoot } from "solid-js"

const mocks = vi.hoisted(() => ({
  destroy: vi.fn(async () => {}),
  flush: vi.fn(),
  signal: undefined as ((signal: NodeJS.Signals) => void | Promise<void>) | undefined,
}))

vi.mock("../../../src/cli/cmd/tui/context/helper", () => ({
  createSimpleContext: (input: { init: (props: unknown) => unknown }) => ({ provider: input.init }),
}))
vi.mock("ax-tui/solid", () => ({ useRenderer: () => ({}) }))
vi.mock("../../../src/cli/cmd/tui/renderer", () => ({ destroyTuiRenderer: mocks.destroy }))
vi.mock("../../../src/cli/cmd/tui/win32", () => ({ win32FlushInputBuffer: mocks.flush }))
vi.mock("../../../src/util/signals", () => ({
  registerShutdownSignals: (callback: (signal: NodeJS.Signals) => void | Promise<void>) => {
    mocks.signal = callback
    return () => {
      mocks.signal = undefined
    }
  },
}))

import { ExitProvider, type useExit } from "../../../src/cli/cmd/tui/context/exit"

const disposals: (() => void)[] = []
let previousExitCode: typeof process.exitCode

beforeEach(() => {
  mocks.destroy.mockReset().mockResolvedValue(undefined)
  mocks.flush.mockReset()
  previousExitCode = process.exitCode
  vi.spyOn(process.stderr, "write").mockReturnValue(true)
})

afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose()
  process.exitCode = previousExitCode
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function setup() {
  return createRoot((dispose) => {
    disposals.push(dispose)
    const onExit = vi.fn(async () => {})
    const exit = ExitProvider({ onExit }) as unknown as ReturnType<typeof useExit>
    return { exit, onExit }
  })
}

describe("TUI exit lifecycle", () => {
  test("an explicit exit waits for the flourish and tears down once", async () => {
    const { exit, onExit } = setup()
    const animation = Promise.withResolvers<void>()
    exit.onFlourish(() => animation.promise)
    const pending = exit.flourish()
    expect(mocks.destroy).not.toHaveBeenCalled()
    animation.resolve()
    await pending
    await exit()
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  test("an OS shutdown signal interrupts an active flourish", async () => {
    const { exit, onExit } = setup()
    exit.onFlourish(() => new Promise(() => {}))
    const pending = exit.flourish()
    await Promise.resolve()
    await Promise.resolve()
    mocks.signal!("SIGTERM")
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 200 })
    await pending
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
  })

  test("an abnormal exit interrupts a flourish and retains the failure status", async () => {
    const { exit, onExit } = setup()
    exit.onFlourish(() => new Promise(() => {}))
    const pending = exit.flourish()
    await Promise.resolve()
    await Promise.resolve()
    exit(new Error("Backend failed while exiting"))
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 200 })
    await pending
    expect(process.exitCode).toBe(1)
    expect(process.stderr.write).toHaveBeenCalled()
  })

  test("removing an unmounted flourish cannot leave shutdown waiting forever", async () => {
    const { exit, onExit } = setup()
    exit.onFlourish(() => new Promise(() => {}))
    const pending = exit.flourish()
    await Promise.resolve()
    await Promise.resolve()
    exit.onFlourish(undefined)
    await vi.waitFor(() => expect(onExit).toHaveBeenCalledTimes(1), { timeout: 200 })
    await pending
  })

  test("renderer teardown failure still releases the owned backend", async () => {
    const { exit, onExit } = setup()
    const error = new Error("Renderer teardown failed")
    mocks.destroy.mockRejectedValue(error)
    await expect(exit()).rejects.toBe(error)
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(process.exitCode).toBe(1)
  })
  test("a stalled flourish has a bounded wait", async () => {
    vi.useFakeTimers()
    const { exit, onExit } = setup()
    exit.onFlourish(() => new Promise(() => {}))
    const pending = exit.flourish()
    await vi.advanceTimersByTimeAsync(5_000)
    await pending
    expect(onExit).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  test("a reentrant handler shares one teardown", async () => {
    const { exit, onExit } = setup()
    const handler = vi.fn(() => exit())
    exit.onFlourish(handler)
    const pending = exit.flourish()
    expect(exit.flourish()).toBe(pending)
    await pending
    expect(handler).toHaveBeenCalledTimes(1)
    expect(mocks.destroy).toHaveBeenCalledTimes(1)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  test("a signal before playback prevents a late animation start", async () => {
    const { exit } = setup()
    const handler = vi.fn(async () => {})
    exit.onFlourish(handler)
    const pending = exit.flourish()
    await mocks.signal!("SIGTERM")
    await pending
    expect(handler).not.toHaveBeenCalled()
  })

  test("signal registration returns the task so failures can be observed", async () => {
    const { onExit } = setup()
    const error = new Error("Renderer teardown failed on signal")
    mocks.destroy.mockRejectedValue(error)
    await expect(mocks.signal!("SIGTERM")).rejects.toBe(error)
    expect(onExit).toHaveBeenCalledTimes(1)
  })

  test("terminal flush failure still releases the owned backend", async () => {
    const { exit, onExit } = setup()
    const error = new Error("Terminal flush failed")
    mocks.flush.mockImplementation(() => {
      throw error
    })
    await expect(exit()).rejects.toBe(error)
    expect(onExit).toHaveBeenCalledTimes(1)
  })
  test("backend cleanup failure retains an unsuccessful exit status", async () => {
    const { exit, onExit } = setup()
    const error = new Error("Backend cleanup failed")
    onExit.mockRejectedValue(error)
    await expect(exit()).rejects.toBe(error)
    expect(process.exitCode).toBe(1)
  })
})
