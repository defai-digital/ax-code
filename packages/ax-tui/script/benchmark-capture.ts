import assert from "node:assert/strict"
import { performance } from "node:perf_hooks"
import { OptimizedBuffer, RGBA } from "../index.js"

// Run with: node --experimental-ffi --import tsx script/benchmark-capture.ts
// Fixed workload, warm cache, seven samples; output includes the median of each.
const buffer = OptimizedBuffer.create(120, 40, "unicode")
const fg = RGBA.fromHex("#abcdef")
try {
  buffer.clear(RGBA.fromHex("#123456"))
  for (let y = 0; y < 40; y++) buffer.drawText("The quick brown fox jumps over the lazy dog. ".repeat(2), 0, y, fg)
  const capture = () => {
    const lines = buffer.getSpanLines()
    assert.equal(lines.length, 40)
    assert.equal(lines[0].spans.map((span) => span.text).join("").length, 120)
  }
  for (let i = 0; i < 50; i++) capture()
  const samples = []
  for (let sample = 0; sample < 7; sample++) {
    const start = performance.now()
    for (let i = 0; i < 200; i++) capture()
    samples.push((performance.now() - start) / 200)
  }
  const sorted = [...samples].sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      workload: "120x40 ASCII span capture",
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      samplesMs: samples,
      medianMs: sorted[3],
    }),
  )
} finally {
  buffer.destroy()
}
