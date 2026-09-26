import { describe, expect, test } from "vitest"
import { inflateSync } from "node:zlib"
import {
  FOLIAGE_COLORS,
  FOLIAGE_CYCLE_MS,
  foliageCells,
  foliageLeaves,
  isFoliageVariant,
  renderFoliagePixels,
} from "../../../src/cli/tui/component/foliage-view-model"
import { digitalCodePixelPlayer } from "../../../src/cli/tui/component/digital-code-pixels"

describe("falling foliage", () => {
  test.each(["classic-foliage", "golden-foliage"] as const)(
    "%s falls deterministically and loops with the cycle",
    (variant) => {
      const first = foliageLeaves(320, 180, variant, 0)
      const moving = foliageLeaves(320, 180, variant, 1200)
      expect(first).toHaveLength(12)
      expect(first).toEqual(foliageLeaves(320, 180, variant, 0))
      expect(first).not.toEqual(moving)
      expect(first).toEqual(foliageLeaves(320, 180, variant, FOLIAGE_CYCLE_MS))
      expect(foliageLeaves(320, 180, variant, -100)).toEqual(first)
      // Fall and sway advance with elapsed time alone.
      expect(moving[0]!.phase).toBeGreaterThan(first[0]!.phase)
      expect(moving[0]!.y).not.toBe(first[0]!.y)
      for (const leaf of first) {
        expect(leaf.color).toBeGreaterThanOrEqual(0)
        expect(leaf.color).toBeLessThan(FOLIAGE_COLORS[variant].length)
        expect(leaf.shape).toBeGreaterThanOrEqual(0)
        expect(leaf.shape).toBeLessThan(3)
        expect(leaf.y).toBeGreaterThanOrEqual(-40)
        expect(leaf.y).toBeLessThan(210)
      }
      expect(isFoliageVariant(variant)).toBe(true)
    },
  )
  test.each(["classic-foliage", "golden-foliage"] as const)(
    "%s uses its own colors and clears old pixels",
    (variant) => {
      const pixels = renderFoliagePixels(320, 180, variant, 0)
      expect(pixels.length).toBe(320 * 180 * 3)
      expect(pixels).toEqual(renderFoliagePixels(320, 180, variant, 0))
      expect(pixels).not.toEqual(renderFoliagePixels(320, 180, variant, 1200))
      expect(pixels.some((v) => v !== 5)).toBe(true)
      const colors = new Set(
        FOLIAGE_COLORS[variant].flatMap((c) => [c.join(","), c.map((v) => Math.round(v * 0.65)).join(",")]),
      )
      for (let i = 0; i < pixels.length; i += 3) {
        const color = [...pixels.subarray(i, i + 3)].join(",")
        expect(color === "5,5,5" || colors.has(color)).toBe(true)
      }
      for (const [width, height] of [
        [1, 1],
        [36, 20],
        [80, 30],
      ]) {
        const rows = foliageCells(640, 384, variant, 500, width!, height!)
        expect(rows).toHaveLength(height!)
        for (const row of rows) {
          const text = row.map((r) => r.text).join("")
          expect(text).toHaveLength(width!)
          expect(text).toMatch(/^[\x20-\x7e]*$/)
        }
      }
    },
  )
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
