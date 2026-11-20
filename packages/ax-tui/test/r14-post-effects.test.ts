import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// Link attributes and flame direction live in the native-backed buffer path,
// so the scenarios run in a Node child process with FFI enabled.
test.skipIf(!supportsFfi)("post effects preserve link ids and flame direction", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 60_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

const script = `
import assert from "node:assert/strict"
import { OptimizedBuffer, RGBA, DistortionEffect, FlamesEffect } from "@defai-digital/ax-tui"

const fg = RGBA.fromInts(255, 255, 255, 255)
const bg = RGBA.fromInts(0, 0, 0, 255)
const linked = (5 << 8) | 1

// A row shift must carry the full 32-bit attribute word: link ids live above
// bit 8 and a byte-wide temp array truncates them to zero.
{
  const buffer = OptimizedBuffer.create(4, 1, "unicode")
  try {
    buffer.clear(bg)
    buffer.setCell(0, 0, "L", fg, bg, linked)
    buffer.setCell(1, 0, "M", fg, bg, 1)
    const effect = new DistortionEffect()
    effect.activeGlitches = [{ y: 0, type: "shift", amount: 1 }]
    effect.glitchDuration = Number.POSITIVE_INFINITY
    effect.apply(buffer, 0)
    const attrs = buffer.buffers.attributes
    assert.equal((attrs[1] >>> 8) & 0xffffff, 5, "shift lost link id: " + attrs[1])
    assert.equal(attrs[1] & 0xff, 1, "shift lost style bits: " + attrs[1])
    assert.equal(buffer.buffers.char[1], "L".codePointAt(0))
  } finally {
    buffer.destroy()
  }
}

// A row flip must preserve link ids the same way.
{
  const buffer = OptimizedBuffer.create(4, 1, "unicode")
  try {
    buffer.clear(bg)
    buffer.setCell(3, 0, "Z", fg, bg, linked)
    const effect = new DistortionEffect()
    effect.activeGlitches = [{ y: 0, type: "flip" }]
    effect.glitchDuration = Number.POSITIVE_INFINITY
    effect.apply(buffer, 0)
    const attrs = buffer.buffers.attributes
    assert.equal((attrs[0] >>> 8) & 0xffffff, 5, "flip lost link id: " + attrs[0])
    assert.equal(buffer.buffers.char[0], "Z".codePointAt(0))
  } finally {
    buffer.destroy()
  }
}

// Flames rise from the bottom: the top row must stay untouched and the bottom
// row must catch fire.
{
  const buffer = OptimizedBuffer.create(64, 10, "unicode")
  try {
    buffer.clear(bg)
    new FlamesEffect().apply(buffer, 100)
    const bgBytes = buffer.buffers.bg
    for (let x = 0; x < 64; x++) {
      assert.equal(bgBytes[x * 4], 0, "flames wrote to top row at x=" + x)
    }
    let lit = 0
    for (let x = 0; x < 64; x++) {
      if (bgBytes[(9 * 64 + x) * 4] > 0) lit++
    }
    assert.ok(lit > 0, "flames did not light the bottom row")
  } finally {
    buffer.destroy()
  }
}

console.log("r14 post-effects checks passed")
`
