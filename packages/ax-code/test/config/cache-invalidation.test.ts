import path from "node:path"
import { afterEach, expect, test, vi } from "vitest"
import { Auth } from "../../src/auth"
import { Config } from "../../src/config/config"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
import { Instance } from "../../src/project/instance"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  vi.restoreAllMocks()
  await Instance.disposeAll()
})

test("config loaded during boot is evicted before the initializer finishes", async () => {
  await using tmp = await tmpdir({ config: { model: "before/model" } })
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const boot = Instance.provide({
    directory: tmp.path,
    init: async () => {
      expect((await Config.get()).model).toBe("before/model")
      entered.resolve()
      await finish.promise
    },
    fn: async () => (await Config.get()).model,
  })
  await entered.promise
  let invalidated: Promise<void> | undefined
  try {
    await Filesystem.write(path.join(tmp.path, "ax-code.json"), JSON.stringify({ model: "after/model" }))
    invalidated = Config.invalidateAll()
    await new Promise<void>((resolve) => setImmediate(resolve))
    finish.resolve()
    await expect(boot).resolves.toBe("after/model")
    await invalidated
  } finally {
    finish.resolve()
    await Promise.allSettled([boot, invalidated])
  }
})

test("an auth change refreshes provider state already loaded by a pending initializer", async () => {
  await using tmp = await tmpdir()
  const provider = ProviderID.make("groq")
  await Auth.set("groq", { type: "api", key: "before-boot-key" })
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const boot = Instance.provide({
    directory: tmp.path,
    init: async () => {
      expect((await Provider.list())[provider]?.key).toBe("before-boot-key")
      entered.resolve()
      await finish.promise
    },
    fn: async () => (await Provider.list())[provider]?.key,
  })
  let changed: Promise<void> | undefined
  try {
    await Promise.race([entered.promise, boot])
    const started = Promise.withResolvers<void>()
    const invalidate = Provider.invalidateAll
    vi.spyOn(Provider, "invalidateAll").mockImplementation(() => {
      const result = invalidate()
      started.resolve()
      return result
    })
    changed = Auth.set("groq", { type: "api", key: "after-boot-key" })
    await started.promise
    await new Promise<void>((resolve) => setImmediate(resolve))
    finish.resolve()
    await expect(boot).resolves.toBe("after-boot-key")
    await changed
  } finally {
    finish.resolve()
    await Promise.allSettled([boot, changed])
    vi.restoreAllMocks()
    await Auth.remove("groq")
  }
})

test.each(["config", "provider"] as const)("%s invalidation does not resurrect a closing peer", async (kind) => {
  await using tmp = await tmpdir()
  const entered = Promise.withResolvers<void>()
  const finish = Promise.withResolvers<void>()
  const resource = Instance.state(
    () => ({}),
    async () => {
      entered.resolve()
      await finish.promise
    },
  )
  await Instance.provide({ directory: tmp.path, fn: () => resource() })
  const closing = Instance.provide({ directory: tmp.path, fn: () => Instance.dispose() })
  await entered.promise
  const invalidated = kind === "config" ? Config.invalidateAll() : Provider.invalidateAll()
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
  } finally {
    finish.resolve()
    await Promise.all([closing, invalidated])
  }
  expect(Instance.list()).not.toContain(tmp.path)
})

test.each(["config", "provider"] as const)(
  "concurrent initializers can finish %s invalidation before boot resolves",
  async (kind) => {
    await using first = await tmpdir()
    await using second = await tmpdir()
    const ready = Promise.withResolvers<void>()
    let entered = 0
    const completedDuringInit: boolean[] = []
    const pending: Promise<void>[] = []
    const init = async (): Promise<void> => {
      if (++entered === 2) ready.resolve()
      await ready.promise
      let completed = false
      const refresh = kind === "config" ? Config.invalidateAll() : Provider.invalidateAll()
      pending.push(
        refresh.then(() => {
          completed = true
        }),
      )
      // Let the pre-fix dependency cycle unwind after observing it, so the
      // regression can fail without leaving two boot promises stuck forever.
      await new Promise<void>((resolve) => setImmediate(resolve))
      completedDuringInit.push(completed)
    }
    await Promise.all(
      [first.path, second.path].map((directory) => Instance.provide({ directory, init, fn: () => undefined })),
    )
    await Promise.all(pending)
    expect(completedDuringInit).toEqual([true, true])
  },
)
