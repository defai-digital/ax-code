import { describe, expect, test, vi } from "vitest"

// The widget boundary tests below run headlessly against a stubbed Renderable
// base: the scroll/slider state machines under test live in the renderable
// subclasses themselves, not in the native-backed base class.
vi.mock("../src/core/renderable.js", () => {
  class StubRenderable {
    width = 0
    height = 0
    x = 0
    y = 0
    visible = true

    private listeners = new Map<string, ((...args: unknown[]) => void)[]>()

    on(event: string, listener: (...args: unknown[]) => void): this {
      const existing = this.listeners.get(event) ?? []
      existing.push(listener)
      this.listeners.set(event, existing)
      return this
    }

    emit(event: string, ...args: unknown[]): boolean {
      for (const listener of this.listeners.get(event) ?? []) listener(...args)
      return true
    }

    requestRender(): void {}
    add(_child: unknown): void {}
  }

  return { Renderable: StubRenderable }
})

import { clamp } from "../src/lib/clamp.js"
import {
  fitColumnWidthsBalanced,
  fitColumnWidthsProportional,
  normalizeColumnWidth,
} from "../src/lib/table-columns.js"
import { ScrollBarRenderable } from "../src/renderables/ScrollBar.js"
import { SelectRenderable, SelectRenderableEvents } from "../src/renderables/Select.js"
import { SliderRenderable } from "../src/renderables/Slider.js"

const ctx = {} as never

describe("clamp boundary hardening", () => {
  test("keeps finite values inside the closed interval", () => {
    expect(clamp(5, 0, 10)).toBe(5)
    expect(clamp(-1, 0, 10)).toBe(0)
    expect(clamp(11, 0, 10)).toBe(10)
    expect(clamp(0.5, 0, 1)).toBe(0.5)
  })

  test("NaN resolves to the lower bound instead of poisoning state", () => {
    expect(clamp(Number.NaN, 0, 10)).toBe(0)
  })

  test("infinities saturate with their original direction, matching the raw pattern", () => {
    expect(clamp(Number.POSITIVE_INFINITY, 0, 10)).toBe(10)
    expect(clamp(Number.NEGATIVE_INFINITY, 0, 10)).toBe(0)
  })

  test("resolves a degenerate range to the lower bound", () => {
    expect(clamp(5, 10, 0)).toBe(10)
  })
})

describe("table column width boundaries", () => {
  test("normalizes non-finite widths to the minimum instead of NaN", () => {
    expect(normalizeColumnWidth(Number.NaN)).toBe(1)
    expect(normalizeColumnWidth(Number.POSITIVE_INFINITY)).toBe(1)
    expect(normalizeColumnWidth(Number.NEGATIVE_INFINITY)).toBe(1)
    expect(normalizeColumnWidth(7.9)).toBe(7)
    expect(normalizeColumnWidth(0.2)).toBe(1)
  })

  test("proportional fitting preserves the exact largest-remainder distribution", () => {
    expect(fitColumnWidthsProportional([10, 20, 30], 30, 1)).toEqual([6, 10, 14])
  })

  test("balanced fitting evens columns out to the shared floor", () => {
    expect(fitColumnWidthsBalanced([10, 20, 30], 30, 1)).toEqual([10, 10, 10])
  })

  test.each([
    { label: "proportional", fit: fitColumnWidthsProportional },
    { label: "balanced", fit: fitColumnWidthsBalanced },
  ])("$label fitting keeps a NaN column width from poisoning the layout", ({ fit }) => {
    const widths = fit([10, Number.NaN, 30], 24, 1)

    expect(widths).toHaveLength(3)
    for (const width of widths) {
      expect(Number.isFinite(width)).toBe(true)
      expect(Number.isInteger(width)).toBe(true)
      expect(width).toBeGreaterThanOrEqual(1)
    }
    expect(widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(24)
  })

  test.each([
    { label: "proportional", fit: fitColumnWidthsProportional },
    { label: "balanced", fit: fitColumnWidthsBalanced },
  ])("$label fitting returns every column at the hard minimum when no floor fits", ({ fit }) => {
    expect(fit([50, 60], 2, 3)).toEqual([3, 3])
  })

  test("fitting ignores fractional and over-target content without changing totals", () => {
    expect(fitColumnWidthsProportional([2.4, 3.7], 100, 1)).toEqual([2, 3])
    expect(fitColumnWidthsBalanced([], 10, 1)).toEqual([])
  })
})

describe("scroll position boundaries", () => {
  test("NaN scroll position falls back to 0 instead of storing NaN", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.scrollSize = 100
    bar.viewportSize = 10

    bar.scrollPosition = Number.NaN

    expect(bar.scrollPosition).toBe(0)
  })

  test("a viewport larger than the content can never produce a negative position", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.scrollSize = 5
    bar.viewportSize = 10

    bar.scrollPosition = 100

    expect(bar.scrollPosition).toBe(0)
  })

  test("positive-overflow scroll position saturates at the scrollable maximum", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.scrollSize = 100
    bar.viewportSize = 10

    bar.scrollPosition = Number.POSITIVE_INFINITY

    expect(bar.scrollPosition).toBe(90)
  })

  test("finite positions keep clamping into the scrollable range", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.scrollSize = 100
    bar.viewportSize = 10

    bar.scrollPosition = 500
    expect(bar.scrollPosition).toBe(90)

    bar.scrollPosition = -20
    expect(bar.scrollPosition).toBe(0)

    bar.scrollPosition = 42.7
    expect(bar.scrollPosition).toBe(43)
  })

  test("does not consume paging keys when there is no scrollable range", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.scrollSize = 5
    bar.viewportSize = 10

    expect(bar.handleKeyPress({ name: "pagedown" } as never)).toBe(false)
    expect(bar.handleKeyPress({ name: "pageup" } as never)).toBe(false)
    expect(bar.handleKeyPress({ name: "end" } as never)).toBe(false)
    expect(bar.handleKeyPress({ name: "home" } as never)).toBe(false)
  })

  test("still consumes paging keys when scrolling is possible", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.scrollSize = 100
    bar.viewportSize = 10

    expect(bar.handleKeyPress({ name: "pagedown" } as never)).toBe(true)
  })
})

describe("slider value boundaries", () => {
  test("NaN value falls back to the minimum instead of storing NaN", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal", min: 0, max: 100 })
    slider.value = Number.NaN

    expect(slider.value).toBe(0)
  })

  test("finite values keep clamping into [min, max]", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal", min: 10, max: 20 })
    slider.value = 500
    expect(slider.value).toBe(20)

    slider.value = -500
    expect(slider.value).toBe(10)
  })

  test("positive-overflow value saturates at the maximum like the raw pattern", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal", min: 0, max: 100 })
    slider.value = Number.POSITIVE_INFINITY

    expect(slider.value).toBe(100)
  })

  test("NaN viewport size falls back to the minimum thumb size", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal", min: 0, max: 100 })
    slider.viewPortSize = Number.NaN

    expect(slider.viewPortSize).toBe(0.01)
  })

  test("constructor bounds a hostile viewport size like the setter", () => {
    const options = { orientation: "horizontal" as const, min: 0, max: 100 }

    // NaN falls back to the computed default (10% of the range, at least 1).
    expect(new SliderRenderable(ctx, { ...options, viewPortSize: Number.NaN }).viewPortSize).toBe(10)
    expect(new SliderRenderable(ctx, { ...options, viewPortSize: 500 }).viewPortSize).toBe(100)
    expect(new SliderRenderable(ctx, { ...options, viewPortSize: -3 }).viewPortSize).toBe(0.01)
    expect(new SliderRenderable(ctx, { ...options, viewPortSize: Number.POSITIVE_INFINITY }).viewPortSize).toBe(10)
  })
})

describe("select index boundaries", () => {
  const options = [
    { name: "A", description: "first" },
    { name: "B", description: "second" },
  ]

  test("constructor clamps negative, overflowing, and non-finite selectedIndex", () => {
    const make = (selectedIndex: number) =>
      new SelectRenderable(ctx, { width: 10, height: 4, options, selectedIndex })

    expect(make(-5).getSelectedIndex()).toBe(0)
    expect(make(99).getSelectedIndex()).toBe(1)
    expect(make(Number.NaN).getSelectedIndex()).toBe(0)
  })

  test("shrinking options clamps the current selection", () => {
    const select = new SelectRenderable(ctx, { width: 10, height: 4, options, selectedIndex: 1 })
    select.options = [options[0]!]

    expect(select.getSelectedIndex()).toBe(0)
    expect(select.getSelectedOption()?.name).toBe("A")
  })

  test("moving through empty options keeps index 0 and emits nothing", () => {
    const select = new SelectRenderable(ctx, { width: 10, height: 4, options: [] })
    const events: Array<{ index: number; option: unknown }> = []
    select.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number, option: unknown) => {
      events.push({ index, option })
    })

    select.moveDown()
    select.moveUp()

    expect(select.getSelectedIndex()).toBe(0)
    expect(events).toEqual([])
  })
})
