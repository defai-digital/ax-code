import { afterEach, expect, test, vi } from "vitest"

const { initialize, bootstrap, stopped } = vi.hoisted(() => {
  const stopped = new Error("project startup reached")
  return {
    initialize: vi.fn<() => Promise<void>>(),
    bootstrap: vi.fn(async () => {
      throw stopped
    }),
    stopped,
  }
})

vi.mock("../../src/util/log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/util/log")>()
  return { ...actual, Log: { ...actual.Log, init: initialize } }
})
vi.mock("../../src/project/with-instance", () => ({ withTransientInstance: bootstrap }))
vi.mock("../../src/cli/bootstrap", () => {
  throw new Error("Embedded SDK callers must not load CLI bootstrap")
})
vi.mock("../../src/cli/bootstrap/env", () => {
  throw new Error("Embedded SDK callers must not load CLI environment setup")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

test("SDK callers retry failed setup and share runtime readiness without importing CLI startup", async () => {
  vi.stubEnv("AX_CODE", undefined)
  vi.stubEnv("AX_CODE_PID", "embedding-host")
  let release!: () => void
  initialize.mockReturnValue(
    new Promise<void>((resolve) => {
      release = resolve
    }),
  )
  const failure = new Error("logging unavailable on the first attempt")
  initialize.mockRejectedValueOnce(failure)
  const { createAgent } = await import("../../src/sdk/programmatic")
  await expect(createAgent()).rejects.toBe(failure)
  expect(bootstrap).not.toHaveBeenCalled()
  const ready = Promise.allSettled([createAgent(), createAgent()])
  try {
    await Promise.resolve()
    expect(bootstrap).not.toHaveBeenCalled()
    expect(process.env.AX_CODE).toBeUndefined()
  } finally {
    release()
  }
  expect(await ready).toEqual([
    { status: "rejected", reason: stopped },
    { status: "rejected", reason: stopped },
  ])
  expect(initialize).toHaveBeenCalledTimes(2)
  expect(bootstrap).toHaveBeenCalledTimes(2)
  expect(process.env.AX_CODE).toBe("1")
  expect(process.env.AX_CODE_PID).toBe("embedding-host")
})
