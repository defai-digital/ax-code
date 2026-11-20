import { describe, expect, test, vi } from "vitest"

// Headless stub of the native-backed Renderable base: the width/bounds state
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
import { TabSelectRenderable } from "../src/renderables/TabSelect.js"

const ctx = { on: () => {}, off: () => {} } as never

describe("TabSelect tab width rejects non-positive and non-finite values", () => {
  const invalidWidths = [-5, Number.POSITIVE_INFINITY, Number.NaN, 0]

  test("constructor falls back to the default width", () => {
    for (const tabWidth of invalidWidths) {
      expect(new TabSelectRenderable(ctx, { options: [], tabWidth }).getTabWidth()).toBe(20)
    }
  })

  test("setTabWidth falls back to the default width", () => {
    for (const tabWidth of invalidWidths) {
      const tab = new TabSelectRenderable(ctx, { options: [] })
      tab.setTabWidth(tabWidth)
      expect(tab.getTabWidth()).toBe(20)
    }
  })

  test("the tabWidth setter falls back to the default width", () => {
    for (const tabWidth of invalidWidths) {
      const tab = new TabSelectRenderable(ctx, { options: [] })
      tab.tabWidth = tabWidth
      expect(tab.getTabWidth()).toBe(20)
    }
  })

  test("valid widths are preserved", () => {
    const tab = new TabSelectRenderable(ctx, { options: [], tabWidth: 30 })
    expect(tab.getTabWidth()).toBe(30)
    tab.setTabWidth(25)
    expect(tab.getTabWidth()).toBe(25)
    tab.tabWidth = 12
    expect(tab.getTabWidth()).toBe(12)
  })

  test("rendering with a hostile width does not throw", () => {
    const tab = new TabSelectRenderable(ctx, {
      options: [{ name: "Tab", description: "d" }],
      tabWidth: -5,
    })
    tab["width"] = 40
    tab["height"] = 3
    tab["frameBuffer"] = { clear() {}, fillRect() {}, drawText() {} }
    expect(() => tab["refreshFrameBuffer"]()).not.toThrow()
  })
})

describe("Slider bounds reject non-finite min/max", () => {
  test("constructor NaN min falls back to 0 and keeps a usable viewport", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal", min: Number.NaN })
    expect(slider.min).toBe(0)
    expect(slider.viewPortSize).toBe(10)
  })

  test("constructor infinite bounds fall back to the defaults", () => {
    expect(new SliderRenderable(ctx, { orientation: "horizontal", min: Number.POSITIVE_INFINITY }).min).toBe(0)
    expect(new SliderRenderable(ctx, { orientation: "horizontal", max: Number.NaN }).max).toBe(100)
    expect(new SliderRenderable(ctx, { orientation: "horizontal", max: Number.POSITIVE_INFINITY }).max).toBe(100)
  })

  test("setters reject non-finite bounds", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal" })
    slider.min = Number.NaN
    expect(slider.min).toBe(0)
    slider.max = Number.POSITIVE_INFINITY
    expect(slider.max).toBe(100)
    slider.min = Number.NEGATIVE_INFINITY
    expect(slider.min).toBe(0)
    slider.max = Number.NaN
    expect(slider.max).toBe(100)
  })

  test("finite negative bounds stay legal", () => {
    const slider = new SliderRenderable(ctx, { orientation: "horizontal", min: -10, max: -5 })
    expect(slider.min).toBe(-10)
    expect(slider.max).toBe(-5)
  })
})

describe("ScrollBar viewport survives a zero-range collapse", () => {
  test("growing content restores the thumb viewport after a zero range", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.viewportSize = 10
    bar.scrollSize = 100
    expect(bar.slider.viewPortSize).toBe(10)
  })

  test("shrinking below the viewport and growing back restores the thumb", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.viewportSize = 10
    bar.scrollSize = 100
    bar.scrollSize = 5
    bar.scrollSize = 100
    expect(bar.slider.viewPortSize).toBe(10)
  })

  test("an unknown viewport is not fabricated into a thumb size", () => {
    const bar = new ScrollBarRenderable(ctx, { orientation: "vertical", width: 1, height: 10 })
    bar.scrollSize = 100
    expect(bar.slider.viewPortSize).toBe(0.01)
  })
})
