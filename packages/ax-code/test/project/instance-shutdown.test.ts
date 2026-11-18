import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test.each(["persistent", "scoped", "reload"] as const)(
  "%s initializer refuses global self-disposal without waiting on its own boot",
  async (mode) => {
    await using tmp = await tmpdir()
    let rejectedDuringInit = false
    let joined: Promise<void> | undefined
    const init = async (): Promise<void> => {
      joined = Instance.disposeAll().then(
        () => {},
        (error) => {
          rejectedDuringInit = Instance.InitializingError.isInstance(error)
        },
      )
      // Observe readiness before returning from init, then let the old cycle
      // unwind so a red regression cannot leave the test process stuck.
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    if (mode === "reload") {
      await Instance.provide({ directory: tmp.path, fn: () => undefined })
      await Instance.reload({ directory: tmp.path, init })
    } else {
      const provide = mode === "scoped" ? Instance.provideScoped : Instance.provide
      await provide({ directory: tmp.path, init, fn: () => undefined })
    }
    await joined
    expect(rejectedDuringInit).toBe(true)
  },
)

test("an initializer cannot join an external global shutdown that is waiting for its boot", async () => {
  await using tmp = await tmpdir()
  const entered = Promise.withResolvers<void>()
  const check = Promise.withResolvers<void>()
  let rejectedDuringInit = false
  let joined: Promise<void> | undefined
  const boot = Instance.provide({
    directory: tmp.path,
    init: async () => {
      entered.resolve()
      await check.promise
      joined = Instance.disposeAll().then(
        () => {},
        (error) => {
          rejectedDuringInit = Instance.InitializingError.isInstance(error)
        },
      )
      await new Promise<void>((resolve) => setImmediate(resolve))
    },
    fn: () => undefined,
  })
  await entered.promise
  const shutdown = Instance.disposeAll()
  check.resolve()
  await Promise.all([boot, shutdown])
  await joined
  expect(rejectedDuringInit).toBe(true)
  expect(Instance.list()).not.toContain(tmp.path)
})

test("a shutdown-start listener joins the existing operation without starting a second one", async () => {
  let starts = 0
  const joined: Promise<void>[] = []
  const unsubscribe = Instance.onLifecycle((event) => {
    if (event.kind === "dispose_all.start" && ++starts === 1) joined.push(Instance.disposeAll())
  })
  try {
    await Instance.disposeAll()
    await Promise.all(joined)
    expect(starts).toBe(1)
  } finally {
    unsubscribe()
  }
})

test("recursive global disposal from cleanup finishes before the outer shutdown reports ready", async () => {
  await using tmp = await tmpdir()
  let cleaned = false
  let cleanedAtReady: boolean | undefined
  const state = Instance.state(
    () => ({}),
    async () => {
      await Instance.disposeAll()
      cleaned = true
    },
  )
  await Instance.provide({ directory: tmp.path, fn: () => state() })
  const unsubscribe = Instance.onLifecycle((event) => {
    if (event.kind === "dispose_all.ready") cleanedAtReady = cleaned
  })
  try {
    await Instance.disposeAll()
    expect(cleanedAtReady).toBe(true)
  } finally {
    unsubscribe()
  }
})

test("global disposal requested by cleanup lets cleanup finish and keeps ordinary callers waiting", async () => {
  await using first = await tmpdir()
  await using second = await tmpdir()
  const requested = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  let otherCleaned = false
  const state = Instance.state(
    () => ({}),
    async () => {
      await Instance.disposeAll()
      requested.resolve()
      await finish.promise
    },
  )
  const other = Instance.state(
    () => ({}),
    async () => {
      otherCleaned = true
    },
  )
  await Instance.provide({ directory: first.path, fn: () => state() })
  await Instance.provide({ directory: second.path, fn: () => other() })
  const disposing = Instance.provide({ directory: first.path, fn: () => Instance.dispose() })
  let joined = false
  try {
    await requested.promise
    const shutdown = Instance.disposeAll().then(() => {
      joined = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(joined).toBe(false)
    expect(otherCleaned).toBe(false)
    finish.resolve()
    await Promise.all([disposing, shutdown])
    expect(otherCleaned).toBe(true)
    expect(Instance.list()).not.toContain(first.path)
    expect(Instance.list()).not.toContain(second.path)
  } finally {
    finish.resolve()
    await disposing
  }
})

test("failed initialization can request global disposal during cleanup without waiting for its own rejection", async () => {
  await using tmp = await tmpdir()
  const failure = new Error("initialization failed")
  let cleaned = false
  let cleanedAtReady: boolean | undefined
  const state = Instance.state(
    () => ({}),
    async () => {
      await Instance.disposeAll()
      cleaned = true
    },
  )
  const unsubscribe = Instance.onLifecycle((event) => {
    if (event.kind === "dispose.ready" && event.directory === tmp.path) cleanedAtReady = cleaned
  })
  try {
    await expect(
      Instance.provide({
        directory: tmp.path,
        init: async () => {
          state()
          throw failure
        },
        fn: () => undefined,
      }),
    ).rejects.toBe(failure)
    await Instance.disposeAll()
    expect(cleanedAtReady).toBe(true)
    expect(Instance.list()).not.toContain(tmp.path)
  } finally {
    unsubscribe()
  }
})
