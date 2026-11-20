import { describe, expect, test, vi } from "vitest"

// Headless stub of the native-backed Renderable base: the thumb-sizing state
// machines under test live in the subclasses, not in the native base class.
vi.mock("../src/core/renderable.js", () => {
  class StubRenderable {
    width = 0
    height = 0
    x = 0
    y = 0
    visible = true
    id: string | undefined
    yogaNode = { setMeasureFunc() {}, markDirty() {} }

    constructor(ctx: unknown, options?: { id?: string }) {
      this._ctx = ctx
      this.id = options?.id
    }

    protected _ctx: unknown

    get ctx(): unknown {
      return this._ctx
    }

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

    off(_event: string, _listener: (...args: unknown[]) => void): this {
      return this
    }

    requestRender(): void {}
    add(_child: unknown): void {}
    remove(_id: unknown): void {}
  }

  return { Renderable: StubRenderable }
})

import { ScrollBarRenderable } from "../src/renderables/ScrollBar.js"

const ctx = { on: () => {}, off: () => {} } as never

const makeBar = (options: Record<string, unknown> = {}) =>
  new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10, ...options } as never)

describe("ScrollBar arrow colors", () => {
  test("background-only arrowOptions keeps the default white foreground", () => {
    const bar = makeBar({ showArrows: true, arrowOptions: { backgroundColor: "#ff0000" } })
    for (const arrow of [bar.startArrow, bar.endArrow]) {
      expect(arrow.foregroundColor.r).toBe(1)
      expect(arrow.foregroundColor.g).toBe(1)
      expect(arrow.foregroundColor.b).toBe(1)
      expect(arrow.backgroundColor.r).toBe(1)
      expect(arrow.backgroundColor.g).toBe(0)
    }
  })

  test("an explicit foreground color still wins on both arrows", () => {
    const bar = makeBar({ showArrows: true, arrowOptions: { foregroundColor: "#00ff00" } })
    for (const arrow of [bar.startArrow, bar.endArrow]) {
      expect(arrow.foregroundColor.r).toBe(0)
      expect(arrow.foregroundColor.g).toBe(1)
      expect(arrow.foregroundColor.b).toBe(0)
    }
  })
})

describe("ScrollBar trackOptions stays inside the scroll state contract", () => {
  test("trackOptions max cannot override the real scroll range", () => {
    const bar = makeBar()
    bar.viewportSize = 10
    bar.scrollSize = 100
    bar.trackOptions = { max: 999 }
    expect(bar.slider.max).toBe(90)
    expect(bar.slider.min).toBe(0)
    expect(bar.slider.viewPortSize).toBe(10)
  })

  test("trackOptions cannot flip the slider orientation at runtime", () => {
    const bar = makeBar()
    bar.trackOptions = { orientation: "horizontal" }
    expect(bar.slider.orientation).toBe("vertical")
  })

  test("constructor trackOptions cannot flip the slider orientation", () => {
    const bar = makeBar({ trackOptions: { orientation: "horizontal" } })
    expect(bar.slider.orientation).toBe("vertical")
  })

  test("trackOptions cannot smuggle clampViewPortToRange onto the slider", () => {
    const bar = makeBar()
    bar.viewportSize = 10
    bar.scrollSize = 11
    bar.trackOptions = { clampViewPortToRange: true, viewPortSize: 10 }
    expect((bar.slider as unknown as Record<string, unknown>).clampViewPortToRange).toBeUndefined()
    expect(bar.slider.viewPortSize).toBe(10)
  })
})

describe("ScrollBar scrollBy rejects non-finite deltas", () => {
  test("NaN and Infinity leave the position untouched", () => {
    const bar = makeBar()
    bar.viewportSize = 10
    bar.scrollSize = 100
    bar.scrollPosition = 50
    bar.scrollBy(Number.NaN)
    expect(bar.scrollPosition).toBe(50)
    bar.scrollBy(Number.POSITIVE_INFINITY)
    expect(bar.scrollPosition).toBe(50)
    bar.scrollBy(Number.NEGATIVE_INFINITY)
    expect(bar.scrollPosition).toBe(50)
    bar.scrollBy(5)
    expect(bar.scrollPosition).toBe(55)
  })
})
