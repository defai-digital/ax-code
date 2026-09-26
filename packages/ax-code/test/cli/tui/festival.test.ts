import { expect, test } from "vitest"
import {
  FESTIVAL_COLUMNS,
  FESTIVAL_CYCLE_MS,
  FESTIVAL_ROWS,
  festivalBackground,
  festivalBurstAge,
  festivalLanterns,
  festivalParticles,
  festivalRows,
} from "../../../src/cli/tui/component/festival-view-model"

test.each(["festival-fireworks", "festival-lanterns"] as const)("%s clips its sky to resized screens", (style) => {
  expect([FESTIVAL_COLUMNS, FESTIVAL_ROWS]).toEqual([76, 25])
  expect(FESTIVAL_CYCLE_MS).toBe(3600)
  for (const [width, height] of [
    [0, 0],
    [1, 1],
    [12, 5],
    [36, 20],
    [80, 30],
    [120, 40],
  ]) {
    for (const elapsed of [0, 900, 1800]) {
      const rows = festivalRows(width!, height!, style, elapsed)
      expect(rows).toHaveLength(height!)
      for (const row of rows) {
        const text = row.map((run) => run.text).join("")
        expect(text).toHaveLength(width!)
        expect(text).toMatch(/^[\x20-\x7e]*$/)
      }
    }
  }
  expect(festivalBackground("festival-fireworks")).not.toBe(festivalBackground("festival-lanterns"))
})

test("bursts stagger around the shared cycle", () => {
  expect(festivalBurstAge(0, 0)).toBe(0)
  expect(festivalBurstAge(0, 1)).toBe(2400)
  expect(festivalBurstAge(0, 2)).toBe(1200)
  expect(festivalBurstAge(3600, 0)).toBe(0)
  expect(festivalBurstAge(1800, 2)).toBe(3000)
  for (const burst of [0, 1, 2]) {
    const particles = festivalParticles(900, burst)
    expect(particles).toHaveLength(16)
    for (const particle of particles) {
      expect(particle.x).toBeGreaterThanOrEqual(0)
      expect(particle.x).toBeLessThan(FESTIVAL_COLUMNS)
      expect(particle.y).toBeGreaterThanOrEqual(0)
      expect(particle.y).toBeLessThan(FESTIVAL_ROWS)
    }
  }
})

test("lanterns rise deterministically and loop with the cycle", () => {
  const first = festivalLanterns(0)
  expect(first).toHaveLength(9)
  expect(festivalLanterns(0)).toEqual(first)
  expect(festivalLanterns(1800)).not.toEqual(first)
  expect(festivalLanterns(3600)).toEqual(first)
  expect(festivalLanterns(-100)).toEqual(first)
})

test.each(["festival-fireworks", "festival-lanterns"] as const)("%s renders deterministically and loops", (style) => {
  const first = festivalRows(76, 25, style, 0)
  expect(festivalRows(76, 25, style, 0)).toEqual(first)
  expect(festivalRows(76, 25, style, 900)).not.toEqual(first)
  expect(festivalRows(76, 25, style, 3600)).toEqual(first)
})

test("fireworks open on a fresh burst above a lit town", () => {
  const rows = festivalRows(76, 25, "festival-fireworks", 0)
  expect(rows[9]!.map((run) => run.text).join("")[18]).toBe("*")
  expect(rows[22]!.map((run) => run.text).join("")).toContain("*")
})

test("rockets climb from the town row before each burst", () => {
  // Burst two (58,10) has age 3000 at t=1800, so its rocket just lifts off.
  const liftoff = festivalRows(76, 25, "festival-fireworks", 1800)
  expect(liftoff[22]!.map((run) => run.text).join("")[58]).toBe("*")
  expect(
    festivalRows(76, 25, "festival-fireworks", 0)[22]!
      .map((run) => run.text)
      .join("")[58],
  ).toBe(" ")
  // Mid-flight the head clears the town row with a fading trail behind it.
  const flight = festivalRows(76, 25, "festival-fireworks", 2100)
  expect(flight[16]!.map((run) => run.text).join("")[58]).toBe("*")
  expect(flight[18]!.map((run) => run.text).join("")[58]).toBe("|")
})

test("lantern flames flicker between glow and dark", () => {
  const bright = festivalRows(76, 25, "festival-lanterns", 0).flat()
  const dimmed = festivalRows(76, 25, "festival-lanterns", 200).flat()
  expect(bright.some((run) => run.background === "#241610")).toBe(false)
  expect(dimmed.some((run) => run.background === "#241610")).toBe(true)
  expect(dimmed.some((run) => run.background === "#4a2f1a")).toBe(false)
})

test("lanterns rise past the moon above a lit town", () => {
  const text = festivalRows(76, 25, "festival-lanterns", 0)
    .map((row) => row.map((run) => run.text).join(""))
    .join("\n")
  expect(text).toContain("( )")
  expect(text).toContain("(   )")
})
