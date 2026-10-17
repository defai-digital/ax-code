import { afterEach, expect, test, vi } from "vitest"

import { NativePerf } from "../../src/perf/native"

afterEach(() => {
  delete process.env.AX_CODE_PROFILE_NATIVE
  NativePerf.reset()
  vi.restoreAllMocks()
})

test("records native bridge calls", () => {
  process.env.AX_CODE_PROFILE_NATIVE = "1"

  const result = NativePerf.run("fs.walkFiles", { cwd: "/tmp", glob: ["*.ts"] }, () => ["a.ts", "b.ts"])

  expect(result).toEqual(["a.ts", "b.ts"])

  const snap = NativePerf.snapshot()
  expect(snap.total.calls).toBe(1)
  expect(snap.rows).toHaveLength(1)
  expect(snap.rows[0]).toMatchObject({
    name: "fs.walkFiles",
    calls: 1,
    fails: 0,
  })
  expect(snap.rows[0]?.inBytes).toBeGreaterThan(0)
  expect(snap.rows[0]?.outBytes).toBeGreaterThan(0)
})

test("records native bridge failures", () => {
  process.env.AX_CODE_PROFILE_NATIVE = "1"

  expect(() =>
    NativePerf.run("diff.unifiedDiff", { old: 2, next: 3 }, () => {
      throw new Error("boom")
    }),
  ).toThrow("boom")

  const snap = NativePerf.snapshot()
  expect(snap.total.calls).toBe(1)
  expect(snap.rows[0]).toMatchObject({
    name: "diff.unifiedDiff",
    calls: 1,
    fails: 1,
  })
})

test("renders a stable summary", () => {
  process.env.AX_CODE_PROFILE_NATIVE = "1"

  NativePerf.run("fs.searchContent", { cwd: "/tmp", pattern: "TODO" }, () => [{ path: "a.ts", line: 1 }])

  const text = NativePerf.render()

  expect(text).toContain("native bridge profile")
  expect(text).toContain("fs.searchContent")
  expect(text).toContain("calls=1")
})

test("phase timing includes queue, conversion and total without inspecting results", async () => {
  process.env.AX_CODE_PROFILE_NATIVE = "1"
  let now = 0
  vi.spyOn(performance, "now").mockImplementation(() => now)
  const secret = {
    toJSON() {
      throw new Error("must never serialize payload")
    },
  }
  expect(
    await NativePerf.operation("test.pipeline", async (trace) => {
      trace!.run("encode", () => {
        now += 3
      })
      const wait = trace!.start("queue")
      now += 7
      wait()
      wait() // Completing a queue span twice must not double-count it.
      await trace!.runAsync("native", async () => {
        now += 11
      })
      trace!.run("decode", () => {
        now += 5
      })
      trace!.run("format", () => {
        now += 2
      })
      return secret
    }),
  ).toBe(secret)
  const snapshot = NativePerf.snapshot()
  expect(snapshot.total.calls).toBe(0)
  expect(snapshot.operations[0].phases).toMatchObject({
    encode: { totalMs: 3 },
    queue: { calls: 1, totalMs: 7 },
    native: { totalMs: 11 },
    decode: { totalMs: 5 },
    format: { totalMs: 2 },
    total: { totalMs: 28, p95Ms: 28 },
  })
  expect(NativePerf.render()).toContain("phase=decode")
})

test("disabled phases do not sample the clock or retain payloads", async () => {
  process.env.AX_CODE_PROFILE_NATIVE = "0"
  const clock = vi.spyOn(performance, "now")
  await NativePerf.operation("test.disabled", async (trace) => {
    expect(trace).toBeUndefined()
  })
  expect(clock).not.toHaveBeenCalled()
  expect(NativePerf.snapshot().operations).toEqual([])
})

test("phase failures preserve identity and recent samples stay bounded", async () => {
  process.env.AX_CODE_PROFILE_NATIVE = "1"
  const failure = new Error("original")
  await expect(
    NativePerf.operation("test.failed", async (trace) =>
      trace!.run("decode", () => {
        throw failure
      }),
    ),
  ).rejects.toBe(failure)
  for (let i = 0; i < 300; i++) await NativePerf.operation("test.sampled", async () => undefined)
  const rows = NativePerf.snapshot().operations
  expect(rows.find((r) => r.name === "test.failed")!.phases).toMatchObject({
    decode: { fails: 1 },
    total: { fails: 1 },
  })
  expect(rows.find((r) => r.name === "test.sampled")!.phases.total).toMatchObject({ calls: 300, sampleCount: 256 })
})
