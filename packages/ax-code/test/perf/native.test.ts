import { afterEach, expect, test } from "bun:test"

import { NativePerf } from "../../src/perf/native"

afterEach(() => {
  delete process.env.AX_CODE_PROFILE_NATIVE
  NativePerf.reset()
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
