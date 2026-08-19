import { describe, expect, test, vi } from "vitest"
import { Database } from "../../src/storage/db"

// node:sqlite reports cross-process writer contention as errcode 5
// (SQLITE_BUSY) with the message "database is locked". Retry logic must treat
// this as transient and retryable, and treat everything else as fatal.
const busy = () => Object.assign(new Error("database is locked"), { errcode: 5 })

describe("Database.withBusyRetry", () => {
  test("retries a busy error then returns the result", async () => {
    let calls = 0
    const sleep = vi.fn(async (_ms: number) => {})
    const result = await Database.withBusyRetry(
      () => {
        calls += 1
        if (calls === 1) throw busy()
        return "ok"
      },
      { sleep, random: () => 0 },
    )
    expect(result).toBe("ok")
    expect(calls).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
  })

  test("gives up after `attempts` when busy persists", async () => {
    let calls = 0
    const sleep = vi.fn(async (_ms: number) => {})
    await expect(
      Database.withBusyRetry(
        () => {
          calls += 1
          throw busy()
        },
        { attempts: 3, sleep, random: () => 0 },
      ),
    ).rejects.toThrow("database is locked")
    expect(calls).toBe(3)
    // One sleep between each of the 3 attempts.
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  test("does not retry non-busy errors", async () => {
    let calls = 0
    const sleep = vi.fn(async (_ms: number) => {})
    const error = new Error("attempt to write a readonly database")
    await expect(
      Database.withBusyRetry(
        () => {
          calls += 1
          throw error
        },
        { sleep, random: () => 0 },
      ),
    ).rejects.toBe(error)
    expect(calls).toBe(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  test("backs off exponentially with jitter, capped at maxMs", async () => {
    const delays: number[] = []
    let calls = 0
    await Database.withBusyRetry(
      () => {
        calls += 1
        if (calls < 5) throw busy()
        return "ok"
      },
      {
        attempts: 5,
        baseMs: 100,
        maxMs: 1_000,
        random: () => 0.5,
        sleep: async (ms: number) => {
          delays.push(ms)
        },
      },
    )
    // cap = min(baseMs * 2^attempt, maxMs); delay = floor(random * (cap + 1))
    // with random() === 0.5 → 50, 100, 200, 400.
    expect(delays).toEqual([50, 100, 200, 400])
  })
})

describe("Database.transactionWithBusyRetry", () => {
  test("runs the transaction and returns its result", async () => {
    await expect(Database.transactionWithBusyRetry(() => 42)).resolves.toBe(42)
  })
})
