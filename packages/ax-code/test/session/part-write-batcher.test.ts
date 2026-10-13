import { describe, expect, test, vi } from "vitest"
import { createPartWriteBatcher } from "../../src/session/part-write-batcher"

describe("createPartWriteBatcher", () => {
  test("coalesces multiple schedule calls for the same part to the latest snapshot", async () => {
    const writes: Array<{ id: string; text: string }> = []
    let scheduled: (() => void) | undefined
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push({ ...part })
      },
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    batcher.schedule({ id: "p1", text: "a" })
    batcher.schedule({ id: "p1", text: "ab" })
    batcher.schedule({ id: "p1", text: "abc" })
    expect(batcher.pendingCount()).toBe(1)
    expect(writes).toEqual([])
    scheduled!()
    await batcher.flush()
    expect(writes).toEqual([{ id: "p1", text: "abc" }])
    expect(batcher.pendingCount()).toBe(0)
  })

  test("forceImmediate bypasses the queue and writes immediately", async () => {
    const writes: string[] = []
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push(part.text)
      },
      schedule: () => ({ clear: () => undefined }),
    })
    batcher.schedule({ id: "p1", text: "stale" })
    await batcher.forceImmediate({ id: "p1", text: "final" })
    expect(writes).toEqual(["final"])
    expect(batcher.pendingCount()).toBe(0)
  })

  test("flush drains every pending part", async () => {
    const writes: string[] = []
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push(`${part.id}:${part.text}`)
      },
      schedule: () => ({ clear: () => undefined }),
    })
    batcher.schedule({ id: "a", text: "1" })
    batcher.schedule({ id: "b", text: "2" })
    await batcher.flush()
    expect(writes.sort()).toEqual(["a:1", "b:2"])
  })

  test("onError is invoked when a write rejects", async () => {
    const onError = vi.fn()
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async () => {
        throw new Error("db down")
      },
      onError,
      schedule: () => ({ clear: () => undefined }),
    })
    await expect(batcher.forceImmediate({ id: "p1", text: "x" })).rejects.toThrow("db down")
    expect(onError).toHaveBeenCalledWith(expect.any(Error), "p1")
  })

  test("concurrent forceImmediate calls serialize writeOne in call order", async () => {
    const writes: string[] = []
    const started: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let inFlight = 0
    let maxInFlight = 0

    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        started.push(part.text)
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        if (part.text === "a") await firstGate
        writes.push(part.text)
        inFlight--
      },
      schedule: () => ({ clear: () => undefined }),
    })

    const first = batcher.forceImmediate({ id: "p1", text: "a" })
    // Let the first write start and park on firstGate before enqueueing the second.
    await vi.waitFor(() => {
      expect(started).toEqual(["a"])
    })
    const second = batcher.forceImmediate({ id: "p2", text: "b" })

    // Second must not start writeOne until the first completes.
    await Promise.resolve()
    expect(started).toEqual(["a"])
    expect(writes).toEqual([])

    releaseFirst()
    await Promise.all([first, second])

    expect(writes).toEqual(["a", "b"])
    expect(started).toEqual(["a", "b"])
    expect(maxInFlight).toBe(1)
  })

  test("forceImmediate stays ordered ahead of a concurrent flush of other parts", async () => {
    const writes: string[] = []
    let releaseForce!: () => void
    const forceGate = new Promise<void>((resolve) => {
      releaseForce = resolve
    })
    let scheduled: (() => void) | undefined

    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        if (part.text === "force") await forceGate
        writes.push(part.text)
      },
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })

    const force = batcher.forceImmediate({ id: "p1", text: "force" })
    await vi.waitFor(() => {
      expect(writes).toEqual([])
    })
    // Force is in-flight; a window flush of another part must wait on the chain.
    batcher.schedule({ id: "p2", text: "snap" })
    scheduled!()
    const flush = batcher.flush()

    await Promise.resolve()
    expect(writes).toEqual([])

    releaseForce()
    await Promise.all([force, flush])
    expect(writes).toEqual(["force", "snap"])
  })

  test("a failing write does not drop the other coalesced parts", async () => {
    const writes: string[] = []
    const errors: string[] = []
    const batcher = createPartWriteBatcher<{ id: string }>({
      write: async (part) => {
        if (part.id === "a") throw new Error("disk full")
        writes.push(part.id)
      },
      onError: (_error, id) => errors.push(id),
      schedule: () => ({ clear: () => undefined }),
    })
    batcher.schedule({ id: "a" })
    batcher.schedule({ id: "b" })
    batcher.schedule({ id: "c" })
    await expect(batcher.flush()).rejects.toThrow("disk full")
    expect(writes).toEqual(["b", "c"])
    expect(errors).toEqual(["a"])
  })

  test("an empty flush after a failed window flush does not replay the reported error", async () => {
    let scheduled: (() => void) | undefined
    const batcher = createPartWriteBatcher<{ id: string }>({
      write: async () => {
        throw new Error("disk full")
      },
      onError: () => undefined,
      schedule: (fn) => {
        scheduled = fn
        return { clear: () => undefined }
      },
    })
    batcher.schedule({ id: "p1" })
    scheduled!()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await expect(batcher.flush()).resolves.toBeUndefined()
  })

  test("a failing timer-driven flush reports through onError without an unhandled rejection", async () => {
    const errors: string[] = []
    let scheduled: (() => void) | undefined
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on("unhandledRejection", onUnhandled)
    try {
      const batcher = createPartWriteBatcher<{ id: string }>({
        write: async () => {
          throw new Error("disk full")
        },
        onError: (_error, id) => errors.push(id),
        schedule: (fn) => {
          scheduled = fn
          return { clear: () => undefined }
        },
      })
      batcher.schedule({ id: "p1" })
      scheduled!()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(errors).toEqual(["p1"])
      expect(unhandled).toEqual([])
    } finally {
      process.off("unhandledRejection", onUnhandled)
    }
  })

  test("windowFor sets the arming delay and a later snapshot of the same part does not re-arm", async () => {
    const writes: string[] = []
    const delays: number[] = []
    const seen: string[] = []
    let fire: (() => void) | undefined
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push(part.text)
      },
      windowFor: (part) => {
        seen.push(part.text)
        return part.text.length * 100
      },
      schedule: (fn, ms) => {
        delays.push(ms)
        fire = fn
        return { clear: () => undefined }
      },
    })

    batcher.schedule({ id: "p1", text: "abcd" })
    expect(seen[0]).toBe("abcd")
    expect(delays).toEqual([400])
    batcher.schedule({ id: "p1", text: "abcdefghij" })
    expect(delays).toEqual([400])
    expect(writes).toEqual([])
    fire!()
    await batcher.flush()
    expect(writes).toEqual(["abcdefghij"])
  })

  test("without windowFor the delay is 250 or the provided windowMs", () => {
    const delays: number[] = []
    const schedule = (_fn: () => void, ms: number) => {
      delays.push(ms)
      return { clear: () => undefined }
    }
    createPartWriteBatcher<{ id: string }>({
      write: () => undefined,
      schedule,
    }).schedule({ id: "a" })
    createPartWriteBatcher<{ id: string }>({
      write: () => undefined,
      windowMs: 80,
      schedule,
    }).schedule({ id: "b" })
    expect(delays).toEqual([250, 80])
  })

  test("windowFor throw, NaN, or a short result falls back to windowMs and a long result clamps to 2000", () => {
    const delays: number[] = []
    const arm = (windowFor: () => number, windowMs?: number) => {
      createPartWriteBatcher<{ id: string }>({
        write: () => undefined,
        windowMs,
        windowFor,
        schedule: (_fn, ms) => {
          delays.push(ms)
          return { clear: () => undefined }
        },
      }).schedule({ id: "p" })
    }
    arm(() => {
      throw new Error("boom")
    })
    arm(() => Number.NaN)
    arm(() => 1)
    arm(() => 1, 100)
    arm(() => 9000)
    expect(delays).toEqual([250, 250, 250, 100, 2000])
  })

  test("forceImmediate during a long window writes immediately and the timer does not rewrite a stale snapshot", async () => {
    const writes: string[] = []
    let fire: (() => void) | undefined
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push(part.text)
      },
      windowFor: () => 2000,
      schedule: (fn) => {
        fire = fn
        return { clear: () => undefined }
      },
    })
    batcher.schedule({ id: "p1", text: "growing" })
    await batcher.forceImmediate({ id: "p1", text: "final" })
    expect(writes).toEqual(["final"])
    fire!()
    await batcher.flush()
    expect(writes).toEqual(["final"])
  })

  test("a shorter cross-part window re-arms the shared timer and a longer window does not", async () => {
    let now = 0
    const writes: string[] = []
    const delays: number[] = []
    let clearCount = 0
    let fire: (() => void) | undefined
    const large = "x".repeat(20)
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: async (part) => {
        writes.push(`${part.id}:${part.text}`)
      },
      now: () => now,
      windowFor: (part) => (part.text.length > 10 ? 2000 : 250),
      schedule: (fn, ms) => {
        delays.push(ms)
        fire = fn
        return {
          clear: () => {
            clearCount++
          },
        }
      },
    })

    batcher.schedule({ id: "large", text: large })
    expect(delays).toEqual([2000])
    now += 100
    batcher.schedule({ id: "small", text: "y" })
    expect(clearCount).toBe(1)
    expect(delays).toEqual([2000, 250])
    expect(delays[1]).toBeLessThanOrEqual(250)
    fire!()
    await batcher.flush()
    expect(writes.sort()).toEqual([`large:${large}`, "small:y"])

    writes.length = 0
    delays.length = 0
    clearCount = 0
    now = 0
    batcher.schedule({ id: "small", text: "y" })
    expect(delays).toEqual([250])
    now += 10
    batcher.schedule({ id: "large", text: large })
    expect(delays).toEqual([250])
    expect(clearCount).toBe(0)
  })

  test("a 1 MiB text stream stays under the size-aware write budget", async () => {
    const chunk = "x".repeat(524)
    // Same rule as processor-impl: 1 ms per 1,024 UTF-16 units, floor 250 ms.
    const processorWindow = (part: { type: string; text: string }) => {
      if (part.type === "text" || part.type === "reasoning") return Math.max(250, part.text.length / 1024)
      return 250
    }

    const run = async (windowFor?: (part: { id: string; type: "text"; text: string }) => number) => {
      type Timer = { at: number; fn: () => void; cleared: boolean }
      const timers: Timer[] = []
      let now = 0
      const advance = (ms: number) => {
        now += ms
        for (;;) {
          let next: Timer | undefined
          for (const timer of timers) {
            if (timer.cleared || timer.at > now) continue
            if (!next || timer.at < next.at) next = timer
          }
          if (!next) break
          next.cleared = true
          next.fn()
        }
      }
      let flushes = 0
      let bytes = 0
      const batcher = createPartWriteBatcher<{ id: string; type: "text"; text: string }>({
        write: (part) => {
          flushes += 1
          bytes += JSON.stringify(part).length
        },
        windowFor,
        now: () => now,
        schedule: (fn, ms) => {
          const timer: Timer = { at: now + ms, fn, cleared: false }
          timers.push(timer)
          return {
            clear: () => {
              timer.cleared = true
            },
          }
        },
      })
      let text = ""
      for (let i = 0; i < 2000; i++) {
        text += chunk
        batcher.schedule({ id: "p1", type: "text", text })
        advance(25)
      }
      await batcher.flush()
      return { flushes, bytes }
    }

    const sized = await run(processorWindow)
    // max(250, length/1024) on this 0→1 MiB ramp flushes about 117 times and
    // writes about 43 MiB. The fixed 250 ms window is about 201 flushes / 101 MiB.
    expect(sized.flushes).toBeLessThan(140)
    expect(sized.bytes).toBeLessThan(48 * 1024 * 1024)

    const fixed = await run(undefined)
    expect(fixed.flushes).toBeGreaterThanOrEqual(150)
  })

  test("forceImmediate that empties the queue releases the long timer so the next part arms its own window", async () => {
    const delays: number[] = []
    let clearCount = 0
    const batcher = createPartWriteBatcher<{ id: string; text: string }>({
      write: () => undefined,
      windowFor: (part) => (part.text.length > 10 ? 2000 : 250),
      schedule: (_fn, ms) => {
        delays.push(ms)
        return {
          clear: () => {
            clearCount++
          },
        }
      },
    })

    batcher.schedule({ id: "large", text: "x".repeat(20) })
    expect(delays).toEqual([2000])
    await batcher.forceImmediate({ id: "large", text: "final" })
    expect(clearCount).toBe(1)
    expect(batcher.pendingCount()).toBe(0)

    // A fresh small part must not wait out the remainder of the 2000 ms window.
    batcher.schedule({ id: "small", text: "y" })
    expect(delays).toEqual([2000, 250])

    // With another id still pending, the timer stays armed for it.
    batcher.schedule({ id: "other", text: "z" })
    await batcher.forceImmediate({ id: "small", text: "done" })
    expect(clearCount).toBe(1)
    expect(batcher.pendingCount()).toBe(1)
  })
})
