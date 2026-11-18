import { afterEach, expect, test, vi } from "vitest"
import { Instance } from "../../src/project/instance"
import { ServiceManager } from "../../src/runtime/service-manager"
import { tmpdir } from "../fixture/fixture"

function gate(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((ready) => {
    resolve = ready
  })
  return { promise, resolve }
}

afterEach(async () => {
  await Instance.disposeAll()
})

test("overlapping scoped callbacks share initialization and a failing caller leaves its peer alive", async () => {
  await using tmp = await tmpdir()
  const entered = gate()
  const leave = gate()
  const disposed = vi.fn(async () => {})
  const init = vi.fn(async () => {})
  const state = Instance.state(() => ({}), disposed)
  const first = Instance.provideScoped({
    directory: tmp.path,
    init,
    fn: async () => {
      state()
      entered.resolve()
      await leave.promise
    },
  })
  await entered.promise
  try {
    const failure = new Error("second callback failed")
    await expect(
      Instance.provideScoped({
        directory: tmp.path,
        init,
        fn: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    expect(disposed).not.toHaveBeenCalled()
    expect(init).toHaveBeenCalledTimes(1)
  } finally {
    leave.resolve()
    await first
  }
  expect(disposed).toHaveBeenCalledTimes(1)
})

test("a failed scoped initializer cleans up its partial state and permits a fresh attempt", async () => {
  await using tmp = await tmpdir()
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ({}), disposed)
  const failure = new Error("initialization failed")
  const callback = vi.fn()
  await expect(
    Instance.provideScoped({
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
  await Instance.provideScoped({ directory: tmp.path, fn: () => state() })
  expect(disposed).toHaveBeenCalledTimes(2)
})

test("new scoped callers wait for the previous generation's cleanup before initializing", async () => {
  await using tmp = await tmpdir()
  const disposing = gate()
  const finish = gate()
  let serial = 0
  const state = Instance.state(
    () => ++serial,
    async (value) => {
      if (value !== 1) return
      disposing.resolve()
      await finish.promise
    },
  )
  const first = Instance.provideScoped({ directory: tmp.path, fn: () => state() })
  await disposing.promise
  const initialized = vi.fn(async () => {})
  const second = Instance.provideScoped({ directory: tmp.path, init: initialized, fn: () => state() })
  try {
    await Promise.resolve()
    expect(initialized).not.toHaveBeenCalled()
  } finally {
    finish.resolve()
  }
  expect(await first).toBe(1)
  expect(await second).toBe(2)
})

test("an initializer can borrow its own pending instance without awaiting itself", async () => {
  await using tmp = await tmpdir()
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ({}), disposed)
  await Instance.provideScoped({
    directory: tmp.path,
    init: async () => {
      const original = state()
      await Instance.provide({ directory: tmp.path, fn: () => expect(state()).toBe(original) })
    },
    fn: () => state(),
  })
  expect(disposed).toHaveBeenCalledTimes(1)
})

test("reload retains scoped ownership while stale disposal cannot tear down the replacement", async () => {
  await using tmp = await tmpdir()
  let serial = 0
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ++serial, disposed)
  await Instance.provideScoped({
    directory: tmp.path,
    fn: async () => {
      expect(state()).toBe(1)
      const staleDispose = Instance.bind(() => Instance.dispose())
      await Instance.reload({
        directory: tmp.path,
        init: async () => {
          await Instance.provide({ directory: tmp.path, fn: () => expect(state()).toBe(2) })
        },
      })
      await staleDispose()
      expect(disposed).toHaveBeenCalledTimes(1)
      await Instance.provide({ directory: tmp.path, fn: () => expect(state()).toBe(2) })
    },
  })
  expect(disposed).toHaveBeenCalledTimes(2)
  expect(Instance.list()).not.toContain(tmp.path)
})

test("a completed old scope cannot dispose an independently created persistent replacement", async () => {
  await using tmp = await tmpdir()
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ({}), disposed)
  await Instance.provideScoped({
    directory: tmp.path,
    fn: async () => {
      state()
      await Instance.dispose()
      await Instance.provide({ directory: tmp.path, fn: () => state() })
    },
  })
  expect(disposed).toHaveBeenCalledTimes(1)
  expect(Instance.list()).toContain(tmp.path)
  await Instance.disposeAll()
  expect(disposed).toHaveBeenCalledTimes(2)
})

test("withExisting maintenance keeps a scoped runtime alive until its callback completes", async () => {
  await using tmp = await tmpdir()
  const entered = gate()
  const leave = gate()
  const maintenanceEntered = gate()
  const finishMaintenance = gate()
  const disposed = vi.fn(async () => {})
  const state = Instance.state(() => ({}), disposed)
  const owner = Instance.provideScoped({
    directory: tmp.path,
    fn: async () => {
      state()
      entered.resolve()
      await leave.promise
    },
  })
  await entered.promise
  const maintenance = Instance.withExisting(tmp.path, async () => {
    maintenanceEntered.resolve()
    await finishMaintenance.promise
    state()
  })
  try {
    await maintenanceEntered.promise
    leave.resolve()
    await owner
    expect(disposed).not.toHaveBeenCalled()
  } finally {
    leave.resolve()
    finishMaintenance.resolve()
    await Promise.all([owner, maintenance])
  }
  expect(disposed).toHaveBeenCalledTimes(1)
})

test("reload holds the lifetime while the last earlier scope leaves during initialization", async () => {
  await using tmp = await tmpdir()
  const entered = gate()
  const leave = gate()
  const initializing = gate()
  const finish = gate()
  const state = Instance.state(() => ({}))
  const owner = Instance.provideScoped({
    directory: tmp.path,
    fn: async () => {
      state()
      entered.resolve()
      await leave.promise
    },
  })
  await entered.promise
  const reload = Instance.reload({
    directory: tmp.path,
    init: async () => {
      initializing.resolve()
      await finish.promise
      await Instance.provide({ directory: tmp.path, fn: () => state() })
    },
  })
  try {
    await initializing.promise
    leave.resolve()
    await owner
  } finally {
    leave.resolve()
    finish.resolve()
    await Promise.all([owner, reload])
  }
  expect(Instance.list()).not.toContain(tmp.path)
})

test("cleanup cannot resurrect its closing instance and recursive disposal is harmless", async () => {
  await using tmp = await tmpdir()
  let blocked: unknown
  const state = Instance.state(
    () => ({}),
    async () => {
      await Instance.dispose()
      try {
        await Instance.provide({ directory: tmp.path, fn: () => state() })
      } catch (error) {
        blocked = error
      }
    },
  )
  await Instance.provideScoped({ directory: tmp.path, fn: () => state() })
  expect(Instance.ShuttingDownError.isInstance(blocked)).toBe(true)
})

test("initializers can borrow their context without awaiting their own unfinished boot", async () => {
  await using tmp = await tmpdir()
  await Instance.provideScoped({
    directory: tmp.path,
    init: async () => {
      await Instance.provide({ directory: tmp.path, fn: () => expect(Instance.directory).toBe(tmp.path) })
      await expect(Instance.reload({ directory: tmp.path })).rejects.toSatisfy(Instance.InitializingError.isInstance)
      await expect(Instance.dispose()).rejects.toSatisfy(Instance.InitializingError.isInstance)
    },
    fn: () => undefined,
  })
  expect(Instance.list()).not.toContain(tmp.path)
})

test("lifecycle event callbacks queue another reload after the current reload finishes", async () => {
  await using tmp = await tmpdir()
  const order: string[] = []
  let next: Promise<unknown> | undefined
  const unsubscribe = Instance.onLifecycle((event) => {
    if (event.directory !== tmp.path || event.kind !== "reload.ready" || next) return
    next = Instance.reload({
      directory: tmp.path,
      init: async () => {
        order.push("second init")
      },
    })
    order.push("first ready")
  })
  try {
    await Instance.provide({ directory: tmp.path, fn: () => undefined })
    await Instance.reload({
      directory: tmp.path,
      init: async () => {
        order.push("first init")
      },
    })
    await next
    expect(order).toEqual(["first init", "first ready", "second init"])
  } finally {
    unsubscribe()
  }
})

test("a bound callback waits for an already queued reload instead of entering the old generation", async () => {
  await using tmp = await tmpdir()
  const entered = gate()
  const finish = gate()
  const callback = vi.fn()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const borrow = Instance.bind(() => Instance.provide({ directory: tmp.path, fn: callback }))
      const reload = Instance.reload({
        directory: tmp.path,
        init: async () => {
          entered.resolve()
          await finish.promise
        },
      })
      const pending = borrow()
      try {
        await entered.promise
        expect(callback).not.toHaveBeenCalled()
      } finally {
        finish.resolve()
        await Promise.all([reload, pending])
      }
      expect(callback).toHaveBeenCalledTimes(1)
    },
  })
})
