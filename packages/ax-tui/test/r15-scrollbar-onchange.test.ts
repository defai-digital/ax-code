import { describe, expect, test, vi } from "vitest"

// Headless stub of the native-backed Renderable base (same harness as
// r14-widget-bounds): the option wiring under test lives in the ScrollBar and
// Slider constructors/setters, not in the native base class.
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

    _mouseListeners: Record<string, unknown> = {}

    set onMouseDown(handler: unknown) {
      if (handler) this._mouseListeners["down"] = handler
      else delete this._mouseListeners["down"]
    }

    set onMouseUp(handler: unknown) {
      if (handler) this._mouseListeners["up"] = handler
      else delete this._mouseListeners["up"]
    }

    set onMouseDrag(handler: unknown) {
      if (handler) this._mouseListeners["drag"] = handler
      else delete this._mouseListeners["drag"]
    }

    set onMouseOver(handler: unknown) {
      if (handler) this._mouseListeners["over"] = handler
      else delete this._mouseListeners["over"]
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

const makeBar = (options: Record<string, unknown> = {}) => {
  const { scrollSize = 100, viewportSize = 10, ...rest } = options
  const bar = new ScrollBarRenderable(ctx, {
    orientation: "vertical",
    width: 1,
    height: 10,
    ...rest,
  } as never)
  bar.scrollSize = scrollSize as number
  bar.viewportSize = viewportSize as number
  return bar
}

describe("ScrollBar trackOptions.onChange must not clobber the internal slider wiring", () => {
  test("ctor trackOptions.onChange keeps thumb -> scroll position propagation intact", () => {
    const positions: number[] = []
    const events: number[] = []
    const bar = makeBar({
      onChange: (p: number) => positions.push(p),
      trackOptions: { onChange: () => {} },
    })
    bar.on("change", (e: { position: number }) => events.push(e.position))

    bar.slider.value = 42

    expect(bar.scrollPosition).toBe(42)
    expect(positions).toEqual([42])
    expect(events).toEqual([42])
  })

  test("setter trackOptions.onChange is ignored and propagation stays intact", () => {
    const positions: number[] = []
    const trackSpy = vi.fn()
    const bar = makeBar({ onChange: (p: number) => positions.push(p) })

    bar.trackOptions = { onChange: trackSpy, backgroundColor: "#ff0000" }
    bar.slider.value = 30

    expect(bar.scrollPosition).toBe(30)
    expect(positions).toEqual([30])
    expect(trackSpy).not.toHaveBeenCalled()
  })

  test("styling-only trackOptions keep propagation working", () => {
    const positions: number[] = []
    const bar = makeBar({
      onChange: (p: number) => positions.push(p),
      trackOptions: { backgroundColor: "#123456" },
    })

    bar.slider.value = 55

    expect(bar.scrollPosition).toBe(55)
    expect(positions).toEqual([55])
  })
})

const mouseListeners = (bar: ReturnType<typeof makeBar>) =>
  (bar.slider as unknown as { _mouseListeners: Record<string, unknown> })._mouseListeners

describe("ScrollBar trackOptions must not replace the slider's internal mouse machinery", () => {
  test("setter trackOptions.onMouseDown/Up/Drag keep the internal drag handlers", () => {
    const bar = makeBar()
    const before = { ...mouseListeners(bar) }
    expect(typeof before["down"]).toBe("function")
    expect(typeof before["drag"]).toBe("function")
    expect(typeof before["up"]).toBe("function")

    const downSpy = vi.fn()
    const dragSpy = vi.fn()
    const upSpy = vi.fn()
    bar.trackOptions = { onMouseDown: downSpy, onMouseDrag: dragSpy, onMouseUp: upSpy }

    const after = mouseListeners(bar)
    expect(after["down"]).toBe(before["down"])
    expect(after["drag"]).toBe(before["drag"])
    expect(after["up"]).toBe(before["up"])
    expect(downSpy).not.toHaveBeenCalled()
  })

  test("ctor trackOptions mouse handlers do not displace the internal machinery", () => {
    const downSpy = vi.fn()
    const bar = makeBar({ trackOptions: { onMouseDown: downSpy } })

    const listeners = mouseListeners(bar)
    expect(listeners["down"]).not.toBe(downSpy)
    expect(typeof listeners["drag"]).toBe("function")
  })

  test("setter still applies additive mouse hooks and styling", () => {
    const bar = makeBar()
    const overSpy = vi.fn()
    bar.trackOptions = { onMouseOver: overSpy, backgroundColor: "#00ff00" }

    expect(mouseListeners(bar)["over"]).toBe(overSpy)
    expect(bar.slider.backgroundColor).toBeDefined()
  })
})
