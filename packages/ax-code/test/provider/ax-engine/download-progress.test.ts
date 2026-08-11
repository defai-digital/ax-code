import { describe, expect, test } from "vitest"
import {
  applyProgressEvent,
  completeProgress,
  formatGiB,
  indeterminateProgress,
  parseGiBTotalFromMessage,
  parseProgressJsonLine,
  percentFromDoneTotal,
  progressFromCacheBytes,
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
    expect(
      parseProgressJsonLine('{"schema_version":"ax.download_model.v1","dest":"/models/x","status":"ok"}'),
    ).toEqual({
      kind: "summary",
      value: { schema_version: "ax.download_model.v1", dest: "/models/x", status: "ok" },
    })
    expect(parseProgressJsonLine("not json")).toEqual({ kind: "ignore" })
    expect(parseProgressJsonLine("")).toEqual({ kind: "ignore" })
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
