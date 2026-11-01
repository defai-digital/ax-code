import { describe, expect, test, vi } from "vitest"
import {
  applyProgressEvent,
  applyProgressMessage,
  completeProgress,
  formatGiB,
  indeterminateProgress,
  parseGiBTotalFromMessage,
  parseProgressJsonLine,
  percentFromDoneTotal,
  progressFromCacheBytes,
  startCacheProgressPolling,
} from "../../../src/provider/ax-engine/download-progress"

describe("download-progress", () => {
  test("percentFromDoneTotal clamps and rounds", () => {
    expect(percentFromDoneTotal(0, 100)).toBe(0)
    expect(percentFromDoneTotal(50, 100)).toBe(50)
    expect(percentFromDoneTotal(100, 100)).toBe(100)
    expect(percentFromDoneTotal(150, 100)).toBe(100)
    expect(percentFromDoneTotal(1, 0)).toBe(0)
  })

  test("applyProgressEvent is monotonic and caps running work at 99%", () => {
    const first = applyProgressEvent(undefined, { done: 5, total: 100, message: "start" }, 1)
    expect(first).toMatchObject({ mode: "determinate", percent: 5, message: "start", updatedAt: 1 })

    const second = applyProgressEvent(first, { done: 85, total: 100, message: "weights" }, 2)
    expect(second.percent).toBe(85)
    expect(second.message).toBe("weights")

    const ready = applyProgressEvent(second, { done: 100, total: 100, message: "Ready" }, 3)
    expect(ready.percent).toBe(99)

    const regress = applyProgressEvent(ready, { done: 10, total: 100, message: "noise" }, 4)
    expect(regress.percent).toBe(99)
  })

  test("completeProgress publishes 100%", () => {
    const running = applyProgressEvent(undefined, { done: 90, total: 100 }, 1)
    expect(completeProgress(running, 2)).toMatchObject({ mode: "determinate", percent: 100, updatedAt: 2 })
  })

  test("indeterminateProgress is the fallback mode", () => {
    expect(indeterminateProgress("Queued…", 9)).toEqual({
      mode: "indeterminate",
      percent: 0,
      message: "Queued…",
      updatedAt: 9,
    })
  })

  test("parseProgressJsonLine distinguishes progress events and summaries", () => {
    expect(parseProgressJsonLine('{"event":"progress","done":5,"total":100,"file":"Downloading"}')).toEqual({
      kind: "progress",
      event: { event: "progress", done: 5, total: 100, file: "Downloading" },
    })
    expect(parseProgressJsonLine('{"schema_version":"ax.download_model.v1","dest":"/models/x","status":"ok"}')).toEqual(
      {
        kind: "summary",
        value: { schema_version: "ax.download_model.v1", dest: "/models/x", status: "ok" },
      },
    )
    expect(parseProgressJsonLine("not json")).toEqual({ kind: "ignore" })
    expect(parseProgressJsonLine("")).toEqual({ kind: "ignore" })
  })

  test("native retry waits arrive as sizeless events and become message-only updates", () => {
    // ax-engine-download emits progress(0, 0, "Download service is busy. Retrying in 4s").
    expect(
      parseProgressJsonLine(
        '{"event":"progress","done":0,"total":0,"file":"Download service is busy. Retrying in 4s"}',
      ),
    ).toEqual({ kind: "message", message: "Download service is busy. Retrying in 4s" })
    expect(parseProgressJsonLine('{"event":"progress","done":0,"total":0,"file":"  "}')).toEqual({ kind: "ignore" })
    expect(parseProgressJsonLine('{"event":"progress","done":0,"total":0}')).toEqual({ kind: "ignore" })
  })

  test("applyProgressMessage keeps the bar and refreshes only the text", () => {
    const running = applyProgressEvent(undefined, { done: 4500, total: 10000, message: "model-00001.safetensors" }, 1)
    const waiting = applyProgressMessage(running, "Download service is busy. Retrying in 4s", 2)
    expect(waiting).toEqual({ ...running, message: "Download service is busy. Retrying in 4s", updatedAt: 2 })
    expect(waiting.percent).toBe(45)
    expect(applyProgressMessage(undefined, "Checking public model files", 3)).toEqual(
      indeterminateProgress("Checking public model files", 3),
    )
  })

  test("native byte-scaled events map onto the same percent scale", () => {
    // The native downloader reports (bytes * 90, total * 100, file) per file.
    const total = 17 * 1024 ** 3
    const half = applyProgressEvent(undefined, { done: (total / 2) * 90, total: total * 100 }, 1)
    expect(half.percent).toBe(45)
    const all = applyProgressEvent(half, { done: total * 90, total: total * 100 }, 2)
    expect(all.percent).toBe(90)
    expect(applyProgressEvent(all, { done: 95, total: 100, message: "Validating model manifest" }, 3).percent).toBe(95)
  })

  test("progressFromCacheBytes maps weight phase into 5–84 and refreshes the message", () => {
    const total = parseGiBTotalFromMessage("Downloading weights (0.0/17.6 GiB, elapsed 0s, ETA estimating)")
    expect(total).toBe(Math.round(17.6 * 1024 ** 3))

    const half = progressFromCacheBytes({
      downloadedBytes: (total ?? 0) / 2,
      totalBytes: total,
      startedAt: Date.now() - 65_000,
      now: Date.now(),
    })
    expect(half.done).toBeGreaterThan(5)
    expect(half.done).toBeLessThanOrEqual(84)
    expect(half.message).toContain(`${formatGiB((total ?? 0) / 2)}/${formatGiB(total ?? 0)} GiB`)
    expect(half.message).toMatch(/elapsed 1m/)
  })
})

describe("cache progress polling", () => {
  test.each(["stopped", "verification", "cancelled"])("discards an in-flight sample after %s", async (reason) => {
    vi.useFakeTimers()
    let stop: (() => void) | undefined
    try {
      const gate = Promise.withResolvers<number>()
      let active = true
      const publish = vi.fn()
      const sample = vi.fn(() => gate.promise)
      stop = startCacheProgressPolling({ sample, active: () => active, publish, onError: vi.fn() })
      await vi.advanceTimersByTimeAsync(250)
      expect(sample).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(4000)
      expect(sample).toHaveBeenCalledTimes(1)
      if (reason === "stopped") stop()
      else active = false
      gate.resolve(1024)
      await vi.advanceTimersByTimeAsync(0)
      expect(publish).not.toHaveBeenCalled()
    } finally {
      stop?.()
      vi.useRealTimers()
    }
  })

  test("stopping before the first sample cancels both timers", async () => {
    vi.useFakeTimers()
    try {
      const sample = vi.fn(async () => 1024)
      const stop = startCacheProgressPolling({ sample, active: () => true, publish: vi.fn(), onError: vi.fn() })
      stop()
      await vi.advanceTimersByTimeAsync(5000)
      expect(sample).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test("reports a failed sample and continues polling", async () => {
    vi.useFakeTimers()
    let stop: (() => void) | undefined
    try {
      const error = new Error("unreadable cache")
      const sample = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(1024)
      const publish = vi.fn()
      const onError = vi.fn()
      stop = startCacheProgressPolling({ sample, active: () => true, publish, onError })
      await vi.advanceTimersByTimeAsync(250)
      expect(onError).toHaveBeenCalledWith(error)
      await vi.advanceTimersByTimeAsync(1750)
      expect(publish).toHaveBeenCalledWith(1024)
    } finally {
      stop?.()
      vi.useRealTimers()
    }
  })
})
