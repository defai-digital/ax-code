import { afterEach, expect, test } from "bun:test"

import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("Instance.state caches values for the same instance", async () => {
  await using tmp = await tmpdir()
  let n = 0
  const state = Instance.state(() => ({ n: ++n }))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const a = state()
      const b = state()
      expect(a).toBe(b)
      expect(n).toBe(1)
    },
  })
})

test("Instance.state isolates values by directory", async () => {
  await using a = await tmpdir()
  await using b = await tmpdir()
  let n = 0
  const state = Instance.state(() => ({ n: ++n }))

  const x = await Instance.provide({
    directory: a.path,
    fn: async () => state(),
  })
  const y = await Instance.provide({
    directory: b.path,
    fn: async () => state(),
  })
  const z = await Instance.provide({
    directory: a.path,
    fn: async () => state(),
  })

  expect(x).toBe(z)
  expect(x).not.toBe(y)
  expect(n).toBe(2)
})

test("Instance.state is disposed on instance reload", async () => {
  await using tmp = await tmpdir()
  const seen: string[] = []
  let n = 0
  const state = Instance.state(
    () => ({ n: ++n }),
    async (value) => {
      seen.push(String(value.n))
    },
  )

  const a = await Instance.provide({
    directory: tmp.path,
    fn: async () => state(),
  })
  await Instance.reload({ directory: tmp.path })
  const b = await Instance.provide({
    directory: tmp.path,
    fn: async () => state(),
  })

  expect(a).not.toBe(b)
  expect(seen).toEqual(["1"])
})

test("Instance.state is disposed on disposeAll", async () => {
  await using a = await tmpdir()
  await using b = await tmpdir()
  const seen: string[] = []
  const state = Instance.state(
    () => ({ dir: Instance.directory }),
    async (value) => {
      seen.push(value.dir)
    },
  )

  await Instance.provide({
    directory: a.path,
    fn: async () => state(),
  })
  await Instance.provide({
    directory: b.path,
    fn: async () => state(),
  })
  await Instance.disposeAll()

  expect(seen.sort()).toEqual([a.path, b.path].sort())
})

test("Instance.state dedupes concurrent promise initialization", async () => {
  await using tmp = await tmpdir()
  let n = 0
  const state = Instance.state(async () => {
    n += 1
    await Bun.sleep(10)
    return { n }
  })

  const [a, b] = await Instance.provide({
    directory: tmp.path,
    fn: async () => Promise.all([state(), state()]),
  })

  expect(a).toBe(b)
  expect(n).toBe(1)
})

test("state.invalidate drops the current entry and next call rebuilds", async () => {
  // This is the primitive the Provider uses to fix issue #13: after
  // Auth.set() the server calls Provider.invalidate() → the cached
  // provider-list state is dropped so the next list() re-reads the
  // refreshed auth.json instead of serving the stale startup cache.
  await using tmp = await tmpdir()
  let n = 0
  const state = Instance.state(() => ({ n: ++n }))

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const a = state()
      expect(a.n).toBe(1)
      // Second call returns the cached value — contract unchanged.
      expect(state().n).toBe(1)
      await state.invalidate()
      // After invalidate the next call rebuilds.
      const b = state()
      expect(b.n).toBe(2)
      expect(a).not.toBe(b)
    },
  })
})

test("state.invalidate runs the dispose hook on the evicted entry", async () => {
  await using tmp = await tmpdir()
  const disposed: number[] = []
  let n = 0
  const state = Instance.state(
    () => ({ n: ++n }),
    async (value) => {
      disposed.push(value.n)
    },
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      state()
      await state.invalidate()
      state()
      await state.invalidate()
    },
  })

  // Both evicted entries had their dispose hook run with the right
  // captured value.
  expect(disposed).toEqual([1, 2])
})

test("state.invalidate on a key that was never initialized is a no-op", async () => {
  await using tmp = await tmpdir()
  let disposedCalls = 0
  const state = Instance.state(
    () => ({ n: 1 }),
    async () => {
      disposedCalls++
    },
  )

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Never called state() first — invalidate must not throw or
      // run the dispose hook on a non-existent entry.
      await state.invalidate()
      expect(disposedCalls).toBe(0)
    },
  })
})
