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
import { SliderRenderable } from "../src/renderables/Slider.js"

const ctx = { on: () => {}, off: () => {} } as never

describe("ScrollBar thumb keeps the real viewport when content barely overflows", () => {
  test("one row past the viewport keeps the full viewport thumb", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.viewportSize = 10
    bar.scrollSize = 11
    expect(bar.slider.viewPortSize).toBe(10)
  })

  test("a range smaller than the viewport does not shrink the thumb", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.viewportSize = 10
    bar.scrollSize = 19
    expect(bar.slider.viewPortSize).toBe(10)
  })

  test("the scrollbar forces unclamped thumb sizing even via trackOptions", () => {
    const bar = new ScrollBarRenderable(ctx, {
      orientation: "vertical",
      width: 1,
      height: 10,
      trackOptions: { clampViewPortToRange: true },
    })
    bar.viewportSize = 10
    bar.scrollSize = 11
    expect(bar.slider.viewPortSize).toBe(10)
  })

  test("horizontal bars keep the real viewport too", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "horizontal", width: 10, height: 1 })
    bar.viewportSize = 8
    bar.scrollSize = 9
    expect(bar.slider.viewPortSize).toBe(8)
  })
})

describe("Slider viewport clamp is opt-out, default stays clamped", () => {
  test("default still caps the viewport to the range", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal", min: 0, max: 1, viewPortSize: 10 })
    expect(slider.viewPortSize).toBe(1)
  })

  test("opt-out keeps a viewport larger than the range across bound changes", () => {
    const slider = new SliderRenderable(ctx, {
      orientation: "horizontal",
      min: 0,
      max: 1,
      viewPortSize: 10,
      clampViewPortToRange: false,
    })
    expect(slider.viewPortSize).toBe(10)
    slider.max = 0
    expect(slider.viewPortSize).toBe(10)
    slider.viewPortSize = 500
    expect(slider.viewPortSize).toBe(500)
    slider.min = 5
    expect(slider.viewPortSize).toBe(500)
  })

  test("opt-out still rejects non-finite and non-positive viewports", () => {
    const slider = new SliderRenderable(ctx, {
      orientation: "horizontal",
      min: 0,
      max: 1,
      viewPortSize: Number.NaN,
      clampViewPortToRange: false,
    })
    expect(slider.viewPortSize).toBe(1)
    slider.viewPortSize = -3
    expect(slider.viewPortSize).toBe(0.01)
    slider.viewPortSize = Number.POSITIVE_INFINITY
    expect(slider.viewPortSize).toBe(0.01)
  })
})
