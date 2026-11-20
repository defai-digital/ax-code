import { describe, expect, test, vi } from "vitest"

// Headless stub of the native-backed Renderable base: the scroll/repeat state
// machines under test live in ScrollBarRenderable itself.
vi.mock("../src/core/renderable.js", () => {
  class StubRenderable {
    width = 0
    height = 0
    x = 0
    y = 0
    visible = true

    constructor(ctx: unknown) {
      this._ctx = ctx
    }

    protected _ctx: unknown

    on(_event: string, _listener: (...args: unknown[]) => void): this {
      return this
    }

    off(_event: string, _listener: (...args: unknown[]) => void): this {
      return this
    }

    emit(_event: string, ..._args: unknown[]): boolean {
      return true
    }

    requestRender(): void {}
    add(_child: unknown): void {}
  }

  return { Renderable: StubRenderable }
})

import { ScrollBarRenderable } from "../src/renderables/ScrollBar.js"
import { CliRenderEvents } from "../src/core/types.js"

type Listener = (...args: unknown[]) => void

function createCtx() {
  const listeners = new Map<string, Set<Listener>>()
  return {
    on(event: string, listener: Listener) {
      const set = listeners.get(event) ?? new Set<Listener>()
      set.add(listener)
      listeners.set(event, set)
      return this
    },
    off(event: string, listener: Listener) {
      listeners.get(event)?.delete(listener)
      return this
    },
    emit(event: string, ...args: unknown[]) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
      return true
    },
    listenerCount(event: string) {
      return listeners.get(event)?.size ?? 0
    },
  }
}

const mouseEvent = { stopPropagation() {}, preventDefault() {} } as never

describe("fractional scroll deltas", () => {
  test("arrow keys move at least one row even with a tiny viewport", () => {
    const bar = new ScrollBarRenderable(createCtx() as never, { orientation: "vertical" })
    bar.scrollSize = 100
    bar.viewportSize = 2
    bar.scrollPosition = 10

    expect(bar.handleKeyPress({ name: "down" } as never)).toBe(true)
    expect(bar.scrollPosition).toBe(11)

    expect(bar.handleKeyPress({ name: "up" } as never)).toBe(true)
    expect(bar.scrollPosition).toBe(10)
  })

  test("pageup moves with a one-row viewport instead of rounding back", () => {
    const bar = new ScrollBarRenderable(createCtx() as never, { orientation: "vertical" })
    bar.scrollSize = 100
    bar.viewportSize = 1
    bar.scrollPosition = 10

    expect(bar.handleKeyPress({ name: "pageup" } as never)).toBe(true)
    expect(bar.scrollPosition).toBe(9)
  })

  test("scrollBy applies sub-unit deltas as a single step in their direction", () => {
    const bar = new ScrollBarRenderable(createCtx() as never, { orientation: "vertical" })
    bar.scrollSize = 100
    bar.viewportSize = 10
    bar.scrollPosition = 10

    bar.scrollBy(0.4)
    expect(bar.scrollPosition).toBe(11)

    bar.scrollPosition = 10
    bar.scrollBy(-0.4)
    expect(bar.scrollPosition).toBe(9)

    bar.scrollPosition = 10
    bar.scrollBy(0)
    expect(bar.scrollPosition).toBe(10)
  })
})

describe("arrow auto-repeat lifecycle", () => {
  test("a global mouse release stops the repeat even when the arrow never sees mouseup", () => {
    vi.useFakeTimers()
    try {
      const ctx = createCtx()
      const bar = new ScrollBarRenderable(ctx as never, { orientation: "vertical" })
      bar.scrollSize = 1000
      bar.viewportSize = 10
      bar.scrollPosition = 100

      bar.endArrow.onMouseDown?.(mouseEvent)
      expect(bar.scrollPosition).toBe(105)

      vi.advanceTimersByTime(500)
      expect(bar.scrollPosition).toBe(110)

      vi.advanceTimersByTime(600)
      expect(bar.scrollPosition).toBe(116)

      // Mode-1000 terminals drop releases outside the pressed renderable, so
      // the arrow-local onMouseUp never fires; the renderer-wide event must
      // still stop the interval.
      ctx.emit(CliRenderEvents.MOUSE_UP)
      vi.advanceTimersByTime(2000)
      expect(bar.scrollPosition).toBe(116)
    } finally {
      vi.useRealTimers()
    }
  })

  test("destroy clears a running repeat and unsubscribes from mouse releases", () => {
    vi.useFakeTimers()
    try {
      const ctx = createCtx()
      const bar = new ScrollBarRenderable(ctx as never, { orientation: "vertical" })
      bar.scrollSize = 1000
      bar.viewportSize = 10
      bar.scrollPosition = 100

      bar.endArrow.onMouseDown?.(mouseEvent)
      expect(bar.scrollPosition).toBe(105)

      bar["destroySelf"]()
      vi.advanceTimersByTime(2000)
      expect(bar.scrollPosition).toBe(105)
      expect(ctx.listenerCount(CliRenderEvents.MOUSE_UP)).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test("a second press on the same arrow replaces the repeat chain instead of orphaning it", () => {
    vi.useFakeTimers()
    try {
      const ctx = createCtx()
      const bar = new ScrollBarRenderable(ctx as never, { orientation: "vertical" })
      bar.scrollSize = 1000
      bar.viewportSize = 10
      bar.scrollPosition = 100

      bar.endArrow.onMouseDown?.(mouseEvent)
      expect(bar.scrollPosition).toBe(105)

      // A second button press before any release must clear the first pending
      // chain; otherwise the orphaned timeout fires after the global release.
      vi.advanceTimersByTime(100)
      bar.endArrow.onMouseDown?.(mouseEvent)
      expect(bar.scrollPosition).toBe(110)

      ctx.emit(CliRenderEvents.MOUSE_UP)
      vi.advanceTimersByTime(2000)
      expect(bar.scrollPosition).toBe(110)
    } finally {
      vi.useRealTimers()
    }
  })

  test("a second press on the start arrow replaces its repeat chain too", () => {
    vi.useFakeTimers()
    try {
      const ctx = createCtx()
      const bar = new ScrollBarRenderable(ctx as never, { orientation: "vertical" })
      bar.scrollSize = 1000
      bar.viewportSize = 10
      bar.scrollPosition = 100

      bar.startArrow.onMouseDown?.(mouseEvent)
      expect(bar.scrollPosition).toBe(95)

      vi.advanceTimersByTime(100)
      bar.startArrow.onMouseDown?.(mouseEvent)
      expect(bar.scrollPosition).toBe(90)

      ctx.emit(CliRenderEvents.MOUSE_UP)
      vi.advanceTimersByTime(2000)
      expect(bar.scrollPosition).toBe(90)
    } finally {
      vi.useRealTimers()
    }
  })
})
