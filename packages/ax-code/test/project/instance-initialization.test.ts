import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { ServiceManager } from "../../src/runtime/service-manager"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("a failed persistent initializer releases its resources before a fresh attempt", async () => {
  await using tmp = await tmpdir()
  let serial = 0
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ++serial, disposed)
  const failure = new Error("persistent initialization failed")
  const callback = vi.fn()
  await expect(
    Instance.provide({
      directory: tmp.path,
      init: async () => {
        state()
        throw failure
      },
      fn: callback,
    }),
  ).rejects.toBe(failure)
  expect(callback).not.toHaveBeenCalled()
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(Instance.list()).not.toContain(tmp.path)
  expect(ServiceManager.peek(tmp.path)).toBeUndefined()
  expect(await Instance.provide({ directory: tmp.path, fn: () => state() })).toBe(2)
})

test("failed persistent waiters share the error while retry waits for cleanup to finish", async () => {
  await using tmp = await tmpdir()
  const entered = Promise.withResolvers<void>()
  const fail = Promise.withResolvers<void>()
  const disposing = Promise.withResolvers<void>()
  const finishCleanup = Promise.withResolvers<void>()
  let serial = 0
  const state = Instance.state(
    () => ++serial,
    async (value) => {
      if (value !== 1) return
      disposing.resolve()
      await finishCleanup.promise
    },
  )
  const failure = new Error("shared initialization failed")
  const first = Instance.provide({
    directory: tmp.path,
    init: async () => {
      state()
      entered.resolve()
      await fail.promise
      throw failure
    },
    fn: () => "must not run",
  })
  await entered.promise
  const callback = vi.fn()
  const outcomes = Promise.allSettled([first, Instance.provide({ directory: tmp.path, fn: callback })])
  fail.resolve()
  await disposing.promise
  const retryInit = vi.fn(async () => {})
  const retry = Instance.provide({ directory: tmp.path, init: retryInit, fn: () => state() })
  try {
    await Promise.resolve()
    expect(retryInit).not.toHaveBeenCalled()
  } finally {
    finishCleanup.resolve()
  }
  expect(await outcomes).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ])
  expect(callback).not.toHaveBeenCalled()
  expect(await retry).toBe(2)
})

test("failed persistent reload initialization cleans up its partial replacement", async () => {
  await using tmp = await tmpdir()
  let serial = 0
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ++serial, disposed)
  await Instance.provide({ directory: tmp.path, fn: () => state() })
  const failure = new Error("reload initialization failed")
  await expect(
    Instance.reload({
      directory: tmp.path,
      init: async () => {
        state()
        throw failure
      },
    }),
  ).rejects.toBe(failure)
  expect(disposed).toHaveBeenCalledTimes(2)
  expect(Instance.list()).not.toContain(tmp.path)
  expect(await Instance.provide({ directory: tmp.path, fn: () => state() })).toBe(3)
})

test("failed discovery clears the service manager even without an instance context", async () => {
  await using tmp = await tmpdir()
  const failure = new Error("project discovery failed")
  vi.spyOn(Project, "fromDirectory").mockRejectedValueOnce(failure)
  const callback = vi.fn()
  await expect(Instance.provide({ directory: tmp.path, fn: callback })).rejects.toBe(failure)
  expect(callback).not.toHaveBeenCalled()
  expect(Instance.list()).not.toContain(tmp.path)
  expect(ServiceManager.peek(tmp.path)).toBeUndefined()
})
