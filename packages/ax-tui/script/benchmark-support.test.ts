import { expect, test } from "vitest"
import { benchmarkOptions, distribution } from "./benchmark-support.js"
import { encodeTextWidthBatch, textWidthByteCapacity, textWidthItemCapacity } from "./text-width-kernel.js"

test("benchmark summaries preserve zero timings, use a median, and report nearest-rank p95", () => {
  expect(distribution([4, 0, 2, 1])).toEqual({ count: 4, min: 0, median: 1.5, p95: 4, max: 4 })
  for (const values of [[], [NaN], [Infinity], [-1]]) expect(() => distribution(values)).toThrow()
})

test("benchmark options reject malformed, duplicate, and unbounded measurements", () => {
  const defaults = { output: "report.json", iterations: 40, warmup: 8 }
  for (const args of [
    ["--samples=0"],
    ["--samples=32"],
    ["--iterations=1e3"],
    ["--iterations=-1"],
    ["--warmup=NaN"],
    ["--warmup=10001"],
    ["--samples=2", "--samples=3"],
    ["--output="],
    ["--backend=other"],
    ["--unknown=1"],
    ["--child", "--child"],
    ["--profile", "--profile"],
  ]) {
    expect(() => benchmarkOptions(args, defaults)).toThrow()
  }
  expect(
    benchmarkOptions(["--samples=1", "--iterations=2", "--warmup=0", "--backend=wasm"], defaults, "kernel"),
  ).toMatchObject({
    samples: 1,
    iterations: 2,
    warmup: 0,
    backend: "wasm",
  })
})

test("batch packing uses UTF-8 byte ranges and bounds both bytes and item counts", () => {
  const batch = encodeTextWidthBatch(["a", "中文", "", "😀"])
  expect([...batch.ranges]).toEqual([0, 1, 1, 6, 7, 0, 7, 4])
  expect(new TextDecoder().decode(batch.bytes)).toBe("a中文😀")
  expect(encodeTextWidthBatch([]).bytes.length).toBe(0)
  expect(() => encodeTextWidthBatch(new Array(textWidthItemCapacity + 1).fill(""))).toThrow("item capacity")
  expect(() => encodeTextWidthBatch(["中".repeat(Math.floor(textWidthByteCapacity / 3) + 1)])).toThrow("byte capacity")
  expect(() => encodeTextWidthBatch(["a".repeat(textWidthByteCapacity), "b"])).toThrow("byte capacity")
  expect(() => encodeTextWidthBatch([undefined as unknown as string])).toThrow("strings")
})
