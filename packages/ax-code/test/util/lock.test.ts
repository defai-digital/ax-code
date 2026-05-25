import { describe, expect, test } from "bun:test"
import { Lock } from "../../src/util/lock"

const SHORT_TIMEOUT_MS = 25

function tick() {
  return new Promise<void>((r) => queueMicrotask(r))
}

async function flush(n = 5) {
  for (let i = 0; i < n; i++) await tick()
}

function dispose(lock: Disposable) {
  lock[Symbol.dispose]()
}

describe("util.lock", () => {
  test("writer exclusivity: blocks reads and other writes while held", async () => {
    const key = "lock:" + Math.random().toString(36).slice(2)

    const state = {
      writer2: false,
      reader: false,
      writers: 0,
    }

    // Acquire writer1
    using writer1 = await Lock.write(key)
    state.writers++
    expect(state.writers).toBe(1)

    // Start writer2 candidate (should block)
    const writer2Task = (async () => {
      const w = await Lock.write(key)
      state.writers++
      expect(state.writers).toBe(1)
      state.writer2 = true
      // Hold for a tick so reader cannot slip in
      await tick()
      return w
    })()

    // Start reader candidate (should block)
    const readerTask = (async () => {
      const r = await Lock.read(key)
      state.reader = true
      return r
    })()

    // Flush microtasks and assert neither acquired
    await flush()
    expect(state.writer2).toBe(false)
    expect(state.reader).toBe(false)

    // Release writer1
    dispose(writer1)
    state.writers--

    // writer2 should acquire next
    const writer2 = await writer2Task
    expect(state.writer2).toBe(true)

    // Reader still blocked while writer2 held
    await flush()
    expect(state.reader).toBe(false)

    // Release writer2
    dispose(writer2)
    state.writers--

    // Reader should now acquire
    const reader = await readerTask
    expect(state.reader).toBe(true)

    dispose(reader)
  })

  test("writer dispose is idempotent and does not release the next writer", async () => {
    const key = "lock:" + Math.random().toString(36).slice(2)
    let writer2Acquired = false
    let readerAcquired = false

    const writer1 = await Lock.write(key)
    const writer2Task = (async () => {
      const writer2 = await Lock.write(key)
      writer2Acquired = true
      return writer2
    })()
    const readerTask = (async () => {
      const reader = await Lock.read(key)
      readerAcquired = true
      return reader
    })()

    await flush()
    expect(writer2Acquired).toBe(false)
    expect(readerAcquired).toBe(false)

    dispose(writer1)
    dispose(writer1)

    const writer2 = await writer2Task
    expect(writer2Acquired).toBe(true)
    await flush()
    expect(readerAcquired).toBe(false)

    dispose(writer2)
    const reader = await readerTask
    expect(readerAcquired).toBe(true)
    dispose(reader)
  })

  test("reader dispose is idempotent and preserves other active readers", async () => {
    const key = "lock:" + Math.random().toString(36).slice(2)
    let writerAcquired = false

    const reader1 = await Lock.read(key)
    const reader2 = await Lock.read(key)
    const writerTask = (async () => {
      const writer = await Lock.write(key)
      writerAcquired = true
      return writer
    })()

    await flush()
    expect(writerAcquired).toBe(false)

    dispose(reader1)
    dispose(reader1)

    await flush()
    expect(writerAcquired).toBe(false)

    dispose(reader2)
    const writer = await writerTask
    expect(writerAcquired).toBe(true)
    dispose(writer)
  })

  test("timed-out writer is not acquired after the current writer releases", async () => {
    const key = "lock:" + Math.random().toString(36).slice(2)
    let acquired = false

    const writer = await Lock.write(key)
    const timedOutWriter = Lock.write(key, { timeoutMs: SHORT_TIMEOUT_MS }).then((lock) => {
      acquired = true
      return lock
    })

    await expect(timedOutWriter).rejects.toThrow(/Lock\.write: timed out/)
    dispose(writer)
    await flush()

    expect(acquired).toBe(false)
    const nextWriter = await Lock.write(key)
    dispose(nextWriter)
  })

  test("timed-out reader is not acquired after the current writer releases", async () => {
    const key = "lock:" + Math.random().toString(36).slice(2)
    let acquired = false

    const writer = await Lock.write(key)
    const timedOutReader = Lock.read(key, { timeoutMs: SHORT_TIMEOUT_MS }).then((lock) => {
      acquired = true
      return lock
    })

    await expect(timedOutReader).rejects.toThrow(/Lock\.read: timed out/)
    dispose(writer)
    await flush()

    expect(acquired).toBe(false)
    const nextReader = await Lock.read(key)
    dispose(nextReader)
  })
})
