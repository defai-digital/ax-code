import { afterEach, beforeEach, expect, test, vi } from "vitest"

const { initialize } = vi.hoisted(() => ({ initialize: vi.fn<() => Promise<void>>() }))

vi.mock("../../src/util/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/util/log")>()
  return { ...actual, Log: { ...actual.Log, init: initialize } }
})
vi.mock("../../src/cli/bootstrap", () => {
  throw new Error("SDK runtime initialization must not load CLI bootstrap")
})
vi.mock("../../src/cli/bootstrap/env", () => {
  throw new Error("SDK runtime initialization must not load CLI environment setup")
})

beforeEach(() => {
  vi.resetModules()
  initialize.mockReset().mockResolvedValue(undefined)
  for (const name of ["AGENT", "AX_CODE", "OPENCODE"]) vi.stubEnv(name, undefined)
  vi.stubEnv("AX_CODE_PID", "parent-runtime")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test("concurrent callers wait for logging and flags before the runtime is ready", async () => {
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  initialize.mockReturnValue(pending)
  const { ensureSdkRuntime } = await import("../../src/sdk/runtime")
  const first = ensureSdkRuntime()
  let secondReady = false
  const second = ensureSdkRuntime().then(() => {
    secondReady = true
  })
  try {
    await Promise.resolve()
    expect(secondReady).toBe(false)
    expect(process.env.AX_CODE).toBeUndefined()
    expect(initialize).toHaveBeenCalledTimes(1)
  } finally {
    release()
    await Promise.all([first, second])
  }
  expect(process.env.AGENT).toBe("1")
  expect(process.env.AX_CODE).toBe("1")
  expect(process.env.OPENCODE).toBe("1")
  expect(process.env.AX_CODE_PID).toBe("parent-runtime")
  await ensureSdkRuntime()
  expect(initialize).toHaveBeenCalledTimes(1)
})

test("failed initialization stays failed for every waiter and can be retried", async () => {
  const failure = new Error("log directory unavailable")
  initialize.mockRejectedValueOnce(failure)
  const { ensureSdkRuntime } = await import("../../src/sdk/runtime")
  const results = await Promise.allSettled([ensureSdkRuntime(), ensureSdkRuntime()])
  expect(results).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ])
  expect(process.env.AX_CODE).toBeUndefined()
  await ensureSdkRuntime()
  expect(initialize).toHaveBeenCalledTimes(2)
  expect(process.env.AX_CODE).toBe("1")
})

test("a synchronous logging failure does not permanently mark the runtime ready", async () => {
  const failure = new Error("synchronous logging failure")
  initialize.mockImplementationOnce(() => {
    throw failure
  })
  const { ensureSdkRuntime } = await import("../../src/sdk/runtime")
  await expect(ensureSdkRuntime()).rejects.toBe(failure)
  await ensureSdkRuntime()
  expect(initialize).toHaveBeenCalledTimes(2)
  expect(process.env.AX_CODE).toBe("1")
})
