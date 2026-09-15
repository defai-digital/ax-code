import { describe, expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import {
  advanceFoliage,
  createFoliage,
  foliageCells,
  FOLIAGE_COLORS,
  renderFoliagePixels,
} from "../../../src/cli/tui/component/foliage-view-model"
import { digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

describe("falling foliage", () => {
  test("bounded particles move downward with elapsed time, recycle, and resize", () => {
    const frame = createFoliage(1280, 720, "classic-foliage", () => 0.5)
    expect(frame.leaves).toHaveLength(45)
    const once = advanceFoliage(frame, 100)
    const twice = advanceFoliage(advanceFoliage(frame, 50), 50)
    expect(once.leaves[0]!.y).toBeCloseTo(twice.leaves[0]!.y)
    expect(once.leaves[0]!.y).toBeGreaterThan(frame.leaves[0]!.y)
    expect(once.leaves[0]!.phase).toBeGreaterThan(frame.leaves[0]!.phase)
    frame.leaves[0]!.y = 1000
    expect(advanceFoliage(frame, 50).leaves[0]!.y).toBe(-30)
    expect(advanceFoliage(frame, 50, 40, 20).width).toBe(40)
    expect(advanceFoliage(frame, 50, 40, 20).leaves.length).toBeLessThanOrEqual(45)
  })
  test.each(["classic-foliage", "golden-foliage"] as const)(
    "%s uses its own colors and clears old pixels",
    (variant) => {
      const frame = createFoliage(320, 180, variant, () => 0.5)
      const pixels = renderFoliagePixels(frame)
      expect(pixels.length).toBe(320 * 180 * 3)
      expect(pixels.some((v) => v !== 5)).toBe(true)
      const colors = new Set(
        FOLIAGE_COLORS[variant].flatMap((c) => [c.join(","), c.map((v) => Math.round(v * 0.65)).join(",")]),
      )
      for (let i = 0; i < pixels.length; i += 3) {
        const color = [...pixels.subarray(i, i + 3)].join(",")
        expect(color === "5,5,5" || colors.has(color)).toBe(true)
      }
      const empty = renderFoliagePixels({ ...frame, leaves: [] })
      expect(empty.every((v) => v === 5)).toBe(true)
      for (const [width, height] of [
        [1, 1],
        [36, 20],
        [80, 30],
      ]) {
        const rows = foliageCells(frame, width!, height!)
        expect(rows).toHaveLength(height!)
        for (const row of rows) {
          const text = row.map((r) => r.text).join("")
          expect(text).toHaveLength(width!)
          expect(text).toMatch(/^[\x20-\x7e]*$/)
        }
      }
    },
  )
  test("clamps an injected random source that returns 1 into the palette and shape ranges", () => {
    // Regression: leaf() used an unclamped Math.floor(random() * N), unlike the
    // sibling glyph() guard in digital-code-view-model.ts. A random of exactly 1
    // produced an out-of-range color/shape, and renderFoliagePixels/foliageCells
    // then dereferenced the undefined palette entry and threw.
    const frame = createFoliage(80, 40, "classic-foliage", () => 1)
    expect(frame.leaves.length).toBeGreaterThan(0)
    for (const leaf of frame.leaves) {
      expect(leaf.color).toBeGreaterThanOrEqual(0)
      expect(leaf.color).toBeLessThan(FOLIAGE_COLORS["classic-foliage"].length)
      expect(leaf.shape).toBeGreaterThanOrEqual(0)
      expect(leaf.shape).toBeLessThan(3)
    }
    expect(() => renderFoliagePixels(frame)).not.toThrow()
    expect(() => foliageCells(frame, 80, 40)).not.toThrow()
  })
  test("pixel transport switches styles and deletes its image only once on disposal", () => {
    const output: string[] = []
    const player = digitalCodePixelPlayer((data) => output.push(data))
    const input = { width: 320, height: 180, columns: 40, rows: 12, direction: "down" as const }
    player.draw({ ...input, style: "classic-foliage" })
    player.draw({ ...input, style: "golden-foliage" })
    const packets = [...output.at(-1)!.matchAll(/\x1b_G[^;]+;([A-Za-z0-9+/=]*)\x1b\\/g)]
    expect(inflateSync(Buffer.from(packets.map((p) => p[1]).join(""), "base64")).length).toBe(320 * 180 * 3)
    expect(output.filter((s) => s.includes("a=d,d=I"))).toHaveLength(1)
    player.dispose()
    player.dispose()
    expect(output.filter((s) => s.includes("a=d,d=I"))).toHaveLength(2)
    player.draw(input)
    expect(output).toHaveLength(4)
  })
})
