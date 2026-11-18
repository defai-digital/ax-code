import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test.each(["persistent", "scoped", "reload"] as const)(
  "%s initialization can finish maintenance against its own context before boot resolves",
  async (mode) => {
    await using tmp = await tmpdir()
    let completedDuringInit = false
    let pending: Promise<unknown> | undefined
    const state = Instance.state(() => ({ context: Instance.current }))
    const init = async (): Promise<void> => {
      const value = state()
      let completed = false
      pending = Instance.withExisting(tmp.path, async () => {
        expect(Instance.current).toBe(value.context)
        expect(state()).toBe(value)
        await Promise.resolve()
        completed = true
      })
      // Observe the pre-fix cycle without leaving a failed regression hung.
      await new Promise<void>((resolve) => setImmediate(resolve))
      completedDuringInit = completed
    }
    if (mode === "reload") {
      await Instance.provide({ directory: tmp.path, fn: () => undefined })
      await Instance.reload({ directory: tmp.path, init })
    } else {
      const provide = mode === "scoped" ? Instance.provideScoped : Instance.provide
      await provide({ directory: tmp.path, init, fn: () => undefined })
    }
    await pending
    expect(completedDuringInit).toBe(true)
  },
)

test("maintenance skips another unfinished initializer instead of waiting for its boot", async () => {
  await using tmp = await tmpdir()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const boot = Instance.provide({
    directory: tmp.path,
    init: async () => {
      entered.resolve()
      await finish.promise
    },
    fn: () => undefined,
  })
  await entered.promise
  let skippedBeforeBoot = false
  let called = false
  const maintenance = Instance.withExisting(tmp.path, () => {
    called = true
  }).then(() => {
    skippedBeforeBoot = true
  })
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(skippedBeforeBoot).toBe(true)
    expect(called).toBe(false)
  } finally {
    finish.resolve()
    await Promise.all([boot, maintenance])
  }
  expect(called).toBe(false)
})

test("a stale bound context cannot enter a pending replacement as its own initializer", async () => {
  await using tmp = await tmpdir()
  const stale = await Instance.provide({
    directory: tmp.path,
    fn: () => Instance.bind(() => Instance.withExisting(tmp.path, () => Instance.current)),
  })
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const reload = Instance.reload({
    directory: tmp.path,
    init: async () => {
      entered.resolve()
      await finish.promise
    },
  })
  await entered.promise
  try {
    await expect(stale()).resolves.toBeUndefined()
  } finally {
    finish.resolve()
    await reload
  }
})

test("failed maintenance in a scoped initializer preserves its error and releases the partial runtime", async () => {
  await using tmp = await tmpdir()
  const failure = new Error("initializer maintenance failed")
  let cleaned = false
  const resource = Instance.state(
    () => ({}),
    async () => {
      cleaned = true
    },
  )
  await expect(
    Instance.provideScoped({
      directory: tmp.path,
      init: async () => {
        resource()
        await Instance.withExisting(tmp.path, async () => {
          throw failure
        })
      },
      fn: () => undefined,
    }),
  ).rejects.toBe(failure)
  expect(cleaned).toBe(true)
  expect(Instance.list()).not.toContain(tmp.path)
})
