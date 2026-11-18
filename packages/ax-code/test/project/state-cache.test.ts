import { expect, test } from "vitest"
import { State } from "../../src/project/state"

test("bulk cache eviction touches only existing entries for that cache", async () => {
  let root = "cache-first"
  let created = 0
  const cache = State.createCache(
    () => root,
    () => ({ serial: ++created }),
  )
  const unrelated = State.createCache(
    () => root,
    () => ({ other: true }),
  )
  const first = cache()
  const other = unrelated()
  root = "cache-second"
  const second = cache()
  root = "cache-never-created"
  const keys: string[] = []
  cache.invalidateAll((key) => {
    keys.push(key)
  })
  expect(keys).toEqual(["cache-first", "cache-second"])
  expect(created).toBe(2)
  root = "cache-first"
  expect(unrelated()).toBe(other)
  expect(cache()).not.toBe(first)
  root = "cache-second"
  expect(cache()).not.toBe(second)
  cache.invalidateAll()
  unrelated.invalidateAll()
})

test("bulk eviction never waits for pending initialization or lets its rejection remove a replacement", async () => {
  const pending = Promise.withResolvers<{ serial: number }>()
  let first = true
  const cache = State.createCache(
    () => "cache-pending",
    () => {
      if (first) {
        first = false
        return pending.promise
      }
      return Promise.resolve({ serial: 2 })
    },
  )
  const original = cache()
  cache.invalidateAll()
  const replacement = cache()
  const failed = expect(original).rejects.toThrow("old initialization failed")
  pending.reject(new Error("old initialization failed"))
  await failed
  expect(cache()).toBe(replacement)
  await expect(replacement).resolves.toEqual({ serial: 2 })
  cache.invalidateAll()
})

test("bulk cache eviction retains disposable resources sharing an initializer", async () => {
  const root = () => "cache-disposable"
  const init = () => ({ resource: true })
  let disposed = false
  const resource = State.create(root, init, async () => {
    disposed = true
  })
  const cache = State.createCache(root, init)
  const value = resource()
  cache.invalidateAll()
  expect(resource()).toBe(value)
  expect(disposed).toBe(false)
  await State.dispose(root())
  expect(disposed).toBe(true)
})

test("reentrant eviction callbacks cannot remove a newly created generation", () => {
  let serial = 0
  const cache = State.createCache(
    () => "cache-reentrant",
    () => ({ serial: ++serial }),
  )
  cache()
  let replacement: { serial: number } | undefined
  cache.invalidateAll(() => {
    cache.invalidateAll()
    replacement = cache()
  })
  expect(cache()).toBe(replacement)
  expect(cache().serial).toBe(2)
  cache.invalidateAll()
})
