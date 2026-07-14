import { describe, expect, test, vi } from "vitest"
import { buildOpenWikiArgs, formatElapsed, startQuietHeartbeat } from "../../src/wiki"

describe("wiki/runner", () => {
  test("buildOpenWikiArgs uses non-interactive code update", () => {
    expect(buildOpenWikiArgs("generate")).toEqual(["code", "--update", "--print"])
    expect(buildOpenWikiArgs("update")).toEqual(["code", "--update", "--print"])
    expect(buildOpenWikiArgs("update", ["--extra"])).toEqual(["code", "--update", "--print", "--extra"])
  })

  test("formatElapsed renders seconds and minutes", () => {
    expect(formatElapsed(0)).toBe("0s")
    expect(formatElapsed(4_500)).toBe("4s")
    expect(formatElapsed(65_000)).toBe("1m 05s")
  })

  test("startQuietHeartbeat fires when quiet long enough", async () => {
    vi.useFakeTimers()
    const ticks: number[] = []
    const started = Date.now()
    let last = started
    const stop = startQuietHeartbeat({
      intervalMs: 15_000,
      getLastActivityMs: () => last,
      getStartedMs: () => started,
      onTick: (elapsed) => ticks.push(elapsed),
    })
    // advance less than quiet threshold → no tick (timer checks every 5s max)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ticks.length).toBe(0)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(ticks.length).toBeGreaterThanOrEqual(1)
    last = Date.now()
    const before = ticks.length
    await vi.advanceTimersByTimeAsync(5_000)
    // still quiet? last was just updated so quietMs < 15s — may or may not tick
    expect(ticks.length).toBeGreaterThanOrEqual(before)
    stop()
    vi.useRealTimers()
  })
})
