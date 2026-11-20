import { describe, expect, test, vi } from "vitest"

// Headless stub of the native-backed Renderable base (same harness as
// r15-scrollbar-onchange): the option wiring under test lives in the ScrollBar
// setters, not in the native base class.
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

const arrowListeners = (arrow: unknown) => (arrow as { _mouseListeners: Record<string, unknown> })._mouseListeners

describe("ScrollBar arrowOptions must not replace the arrows' internal mouse machinery", () => {
  test("setter arrowOptions.onMouseDown/Up keep the internal repeat-scroll handlers", () => {
    const bar = makeBar()
    const startBefore = { ...arrowListeners(bar.startArrow) }
    const endBefore = { ...arrowListeners(bar.endArrow) }
    expect(typeof startBefore["down"]).toBe("function")
    expect(typeof startBefore["up"]).toBe("function")
    expect(typeof endBefore["down"]).toBe("function")
    expect(typeof endBefore["up"]).toBe("function")

    const downSpy = vi.fn()
    const upSpy = vi.fn()
    bar.arrowOptions = { onMouseDown: downSpy, onMouseUp: upSpy }

    expect(arrowListeners(bar.startArrow)["down"]).toBe(startBefore["down"])
    expect(arrowListeners(bar.startArrow)["up"]).toBe(startBefore["up"])
    expect(arrowListeners(bar.endArrow)["down"]).toBe(endBefore["down"])
    expect(arrowListeners(bar.endArrow)["up"]).toBe(endBefore["up"])
    expect(downSpy).not.toHaveBeenCalled()
    expect(upSpy).not.toHaveBeenCalled()
  })

  test("setter still applies additive mouse hooks and styling", () => {
    const bar = makeBar()
    const overSpy = vi.fn()
    bar.arrowOptions = { onMouseOver: overSpy, foregroundColor: "#00ff00" }

    expect(arrowListeners(bar.startArrow)["over"]).toBe(overSpy)
    expect(arrowListeners(bar.endArrow)["over"]).toBe(overSpy)
    expect(bar.startArrow.foregroundColor).toBeDefined()
    expect(bar.endArrow.foregroundColor).toBeDefined()
  })
})
