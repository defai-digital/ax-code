import { spawnSync } from "node:child_process"
import { expect, test } from "vitest"

const supportsFfi = spawnSync(process.execPath, ["--experimental-ffi", "-e", "require('node:ffi')"]).status === 0

// The distortion/rolling-bar/ascii filters operate on native-backed buffers,
// so the scenarios run in a Node child process with FFI enabled.
test.skipIf(!supportsFfi)("post effects wrap correctly at buffer boundaries", () => {
  const result = spawnSync(
    process.execPath,
    ["--experimental-ffi", "--disable-warning=ExperimentalWarning", "--input-type=module", "-e", script],
    { encoding: "utf8", timeout: 60_000 },
  )
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
})

const script = `
import assert from "node:assert/strict"
import { OptimizedBuffer, RGBA, DistortionEffect, CRTRollingBarEffect, CloudsEffect, FlamesEffect, RainbowTextEffect, VignetteEffect, applyAsciiArt, applySaturation } from "@defai-digital/ax-tui"

const fg = RGBA.fromInts(255, 255, 255, 255)
const bg = RGBA.fromInts(0, 0, 0, 255)

// A row shift larger than the row width must wrap, not read out of bounds.
{
  const buffer = OptimizedBuffer.create(5, 2, "unicode")
  try {
    buffer.clear(bg)
    for (let x = 0; x < 5; x++) buffer.drawText(String.fromCharCode(65 + x), x, 0, fg, bg)
    const effect = new DistortionEffect()
    effect.activeGlitches = [{ y: 0, type: "shift", amount: 9 }]
    effect.glitchDuration = Number.POSITIVE_INFINITY
    effect.apply(buffer, 0)

    const chars = [...buffer.buffers.char.slice(0, 5)]
    // The row must still hold the same five glyphs, permuted - no NUL cells.
    assert.deepEqual(
      [...chars].sort(),
      ["A", "B", "C", "D", "E"].map((c) => c.codePointAt(0)).sort((a, b) => a - b),
    )
    assert.ok(chars.every((c) => c >= 65 && c <= 69), String(chars))
  } finally {
    buffer.destroy()
  }
}

// A negative speed must wrap the bar back into the cycle instead of letting
// the position drift negative forever.
{
  const buffer = OptimizedBuffer.create(4, 6, "unicode")
  try {
    const effect = new CRTRollingBarEffect(0.5)
    effect.speed = -2
    effect.apply(buffer, 100)
    assert.ok(effect.position >= 0, \`position \${effect.position}\`)
    assert.ok(Number.isFinite(effect.position))
  } finally {
    buffer.destroy()
  }
}

// An empty ramp has no glyph to map to and must not throw.
{
  const buffer = OptimizedBuffer.create(2, 2, "unicode")
  try {
    buffer.clear(bg)
    assert.doesNotThrow(() => applyAsciiArt(buffer, ""))
  } finally {
    buffer.destroy()
  }
}

// deltaTime arrives in milliseconds while glitch durations are in seconds:
// a 0.1s glitch must survive a single 16ms frame.
{
  const buffer = OptimizedBuffer.create(5, 2, "unicode")
  try {
    buffer.clear(bg)
    const effect = new DistortionEffect()
    effect.activeGlitches = [{ y: 0, type: "shift", amount: 1 }]
    effect.glitchDuration = 0.1
    effect.lastGlitchTime = 0
    effect.apply(buffer, 16)
    assert.equal(effect.activeGlitches.length, 1, "glitch cleared before its duration elapsed")
  } finally {
    buffer.destroy()
  }
}

// Animated effects interpret speed as per-second: 100ms advances time by 0.1 * speed.
{
  const buffer = OptimizedBuffer.create(4, 4, "unicode")
  try {
    buffer.clear(bg)
    for (const effect of [new CloudsEffect(), new FlamesEffect(), new RainbowTextEffect()]) {
      effect.apply(buffer, 100)
      assert.ok(
        Math.abs(effect.time - 0.1 * effect.speed) < 1e-9,
        effect.constructor.name + " time " + effect.time + " after 100ms at speed " + effect.speed,
      )
    }
  } finally {
    buffer.destroy()
  }
}

// Strength 1 is a no-op, but strength 0 must apply full grayscale instead of
// early-returning like a no-op.
{
  const buffer = OptimizedBuffer.create(3, 1, "unicode")
  try {
    buffer.clear(bg)
    const red = RGBA.fromInts(255, 0, 0, 255)
    buffer.drawText("R", 0, 0, red, bg)
    const before = [...buffer.buffers.fg.subarray(0, 4)]
    applySaturation(buffer, undefined, 1)
    assert.deepEqual([...buffer.buffers.fg.subarray(0, 4)], before)
    applySaturation(buffer, undefined, 0)
    const [r, g, b] = buffer.buffers.fg.subarray(0, 4)
    assert.equal(r, g)
    assert.equal(g, b)
    assert.notEqual(r, before[0])
  } finally {
    buffer.destroy()
  }
}

// Attenuation matrices must preserve alpha: a zero matrix with matrix[15] = 0
// fades cells toward transparent instead of toward black.
{
  const buffer = OptimizedBuffer.create(4, 4, "unicode")
  try {
    const base = RGBA.fromInts(200, 100, 50, 255)
    buffer.clear(base)
    buffer.drawText("V", 0, 0, fg, base)
    new VignetteEffect(1).apply(buffer)
    const { fg: fgBytes, bg: bgBytes } = buffer.buffers
    for (let i = 0; i < 16; i++) {
      assert.equal(bgBytes[i * 4 + 3], 255, "vignette bg alpha at cell " + i)
      assert.equal(fgBytes[i * 4 + 3], 255, "vignette fg alpha at cell " + i)
    }
    // Strength 1 fully attenuates the far corner and leaves the center untouched.
    assert.equal(bgBytes[0], 0, "vignette corner red")
    assert.equal(bgBytes[(2 * 4 + 2) * 4], 200, "vignette center red")
  } finally {
    buffer.destroy()
  }
}

{
  const buffer = OptimizedBuffer.create(4, 4, "unicode")
  try {
    const base = RGBA.fromInts(200, 100, 50, 255)
    buffer.clear(base)
    new CloudsEffect(0.5, 0.5, 1, 1).apply(buffer, 100)
    const bgBytes = buffer.buffers.bg
    let darkened = 0
    for (let i = 0; i < 16; i++) {
      assert.equal(bgBytes[i * 4 + 3], 255, "clouds bg alpha at cell " + i)
      if (bgBytes[i * 4] < 200) darkened++
    }
    assert.ok(darkened > 0, "clouds did not attenuate any cell")
  } finally {
    buffer.destroy()
  }
}

console.log("post-effects boundary checks passed")
`
