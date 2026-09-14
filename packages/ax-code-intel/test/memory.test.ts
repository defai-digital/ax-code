import { afterEach, describe, expect, test, vi } from "vitest"
import { memoryProfile, LOW_MEMORY_IDLE_MS, speculativeLspPrewarmEnabled } from "../src/prewarm-profile"
import { ContentCache } from "../src/content-cache"
import { ClientActivity } from "../src/client-activity"
import { WorkQueue, memoryWork } from "../src/memory-work"
import { runWithEnvelope } from "../src/envelope-runner"
import type { LSPClient } from "../src/client"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
afterEach(() => vi.unstubAllEnvs())

describe("memory profile", () => {
  test.each([
    ["normal", undefined, false],
    ["normal", "0", false],
    ["normal", "true", false],
    ["normal", "1", true],
    ["low", undefined, false],
    ["low", "1", false],
  ])("speculative prewarm with profile=%s and opt-in=%s is %s", (profile, optIn, expected) => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", profile)
    vi.stubEnv("AX_CODE_LSP_PREWARM", optIn)
    expect(speculativeLspPrewarmEnabled()).toBe(expected)
  })
  test("selects low at the physical 8 GiB boundary with an explicit override", () => {
    const gib = 1024 ** 3
    expect(memoryProfile({ totalBytes: 8 * gib, override: "auto" })).toBe("low")
    expect(memoryProfile({ totalBytes: 8 * gib + 1, override: "auto" })).toBe("normal")
    expect(memoryProfile({ totalBytes: 128 * gib, override: "low" })).toBe("low")
    expect(memoryProfile({ totalBytes: 4 * gib, override: "normal" })).toBe("normal")
    expect(memoryProfile({ totalBytes: 4 * gib, override: "invalid" })).toBe("low")
    expect(memoryProfile({ totalBytes: NaN, override: "auto" })).toBe("normal")
  })
})

describe("source cache retention", () => {
  test("evicts complete Unicode snapshots by bytes and releases replaced entries", () => {
    const cache = new ContentCache(400)
    cache.set("a", "\u{1F642}".repeat(40))
    const original = cache.bytes
    expect(original).toBe(290)
    cache.set("b", "b".repeat(40))
    expect(cache.get("a")).toBeUndefined()
    expect(cache.bytes).toBeLessThanOrEqual(400)
    cache.set("b", "c")
    expect(cache.bytes).toBe(132)
    cache.delete("b")
    expect(cache.bytes).toBe(0)
    cache.set("large", "x".repeat(500))
    expect(cache.size).toBe(0)
  })
  test("entry budget and replacement preserve exact retained text", () => {
    const cache = new ContentCache(10000, 2)
    cache.set("a", "first")
    cache.set("b", "second")
    cache.set("a", "updated")
    cache.set("c", "third")
    expect(cache.get("a")?.text).toBe("updated")
    expect(cache.get("b")).toBeUndefined()
    cache.clear()
    expect(cache.bytes).toBe(0)
  })
  test("counts multibyte cache keys against the retention budget", () => {
    const cache = new ContentCache(300)
    cache.set("資料".repeat(40), "x")
    expect(cache.size).toBe(0)
    expect(cache.bytes).toBe(0)
  })
})

describe("LSP admission and idle safety", () => {
  test("busy work prevents idle expiry and settle begins a new idle period", async () => {
    const activity = new ClientActivity()
    const gate = deferred()
    const work = activity.run(() => gate.promise)
    expect(activity.idle(performance.now() + LOW_MEMORY_IDLE_MS * 2, LOW_MEMORY_IDLE_MS)).toBe(false)
    gate.resolve()
    await work
    expect(activity.busy).toBe(0)
    expect(activity.idle(activity.lastUse + LOW_MEMORY_IDLE_MS - 1, LOW_MEMORY_IDLE_MS)).toBe(false)
    expect(activity.idle(activity.lastUse + LOW_MEMORY_IDLE_MS, LOW_MEMORY_IDLE_MS)).toBe(true)
  })
  test("FIFO runs every queued item and releases its slot after rejection", async () => {
    const queue = new WorkQueue(1)
    const gate = deferred()
    const order: number[] = []
    const first = queue.run(async () => {
      order.push(1)
      await gate.promise
      throw new Error("fixture")
    })
    const failure = expect(first).rejects.toThrow("fixture")
    const second = queue.run(async () => {
      order.push(2)
      return 2
    })
    const third = queue.run(async () => {
      order.push(3)
      return 3
    })
    expect(order).toEqual([1])
    gate.resolve()
    await failure
    expect(await Promise.all([second, third])).toEqual([2, 3])
    expect(order).toEqual([1, 2, 3])
  })
  test("cancelled queued initialization is removed without waiting for another workspace", async () => {
    const queue = new WorkQueue(1)
    const gate = deferred()
    const active = queue.run(() => gate.promise)
    const controller = new AbortController()
    const call = vi.fn(async () => 1)
    const queued = queue.run(call, controller.signal)
    const rejected = expect(queued).rejects.toThrow("disposed")
    controller.abort(new Error("disposed"))
    await rejected
    expect(call).not.toHaveBeenCalled()
    gate.resolve()
    await active
    expect(await queue.run(async () => 2)).toBe(2)
  })
  test("two process semantic slots preserve identical envelopes across profiles", async () => {
    const clients = Array.from(
      { length: 6 },
      (_, i) => ({ serverID: `server-${i}`, activity: new ClientActivity() }) as LSPClient.Info,
    )
    let active = 0
    let peak = 0
    const evaluate = () =>
      runWithEnvelope({
        file: "/fixture.ts",
        operation: "fixture",
        empty: [] as string[],
        selectClients: async () => ({ clients, freshSpawnCount: 0 }),
        call: async (client) => {
          active++
          peak = Math.max(peak, active)
          await new Promise((resolve) => setImmediate(resolve))
          active--
          return client.serverID
        },
        reduce: (rows) => rows,
      })
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "normal")
    const normal = await evaluate()
    expect(peak).toBe(6)
    peak = 0
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "low")
    const low = await evaluate()
    expect(peak).toBe(2)
    expect({ ...low, timestamp: 0 }).toEqual({ ...normal, timestamp: 0 })
    expect(clients.every((client) => client.activity.busy === 0)).toBe(true)
  })
  test("abort after FIFO admission still rejects before starting the callback", async () => {
    const queue = new WorkQueue(1)
    const gate = deferred()
    const controller = new AbortController()
    const first = queue.run(async () => {
      await gate.promise
      queueMicrotask(() => queueMicrotask(() => controller.abort(new Error("disposed after admission"))))
    })
    const call = vi.fn(async () => 1)
    const next = queue.run(call, controller.signal)
    const rejected = expect(next).rejects.toThrow("disposed after admission")
    gate.resolve()
    await first
    await rejected
    expect(call).not.toHaveBeenCalled()
    expect(await queue.run(async () => 2)).toBe(2)
  })
  test("semantic callers pin clients before waiting for a process slot", async () => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "low")
    const gate = deferred()
    const clients = Array.from(
      { length: 3 },
      (_, i) => ({ serverID: `queued-${i}`, activity: new ClientActivity() }) as LSPClient.Info,
    )
    let started = 0
    const work = clients.map((client) =>
      runWithEnvelope({
        file: "/queued.ts",
        operation: "queued",
        empty: "",
        selectClients: async () => ({ clients: [client], freshSpawnCount: 0 }),
        call: async () => {
          started++
          await gate.promise
          return "same result"
        },
        reduce: (rows) => rows.join(""),
      }),
    )
    await new Promise((resolve) => setImmediate(resolve))
    expect(started).toBe(2)
    expect(clients[2].activity.busy).toBe(1)
    expect(clients[2].activity.idle(performance.now() + LOW_MEMORY_IDLE_MS * 2, LOW_MEMORY_IDLE_MS)).toBe(false)
    gate.resolve()
    expect((await Promise.all(work)).map((result) => result.data)).toEqual(Array(3).fill("same result"))
  })
  test("low profile permits only one concurrent initialization", async () => {
    vi.stubEnv("AX_CODE_MEMORY_PROFILE", "low")
    let active = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 4 }, () =>
        memoryWork("spawn", async () => {
          active++
          peak = Math.max(peak, active)
          await new Promise((resolve) => setImmediate(resolve))
          active--
        }),
      ),
    )
    expect(peak).toBe(1)
  })
})
