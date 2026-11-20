import { describe, expect, test, vi } from "vitest"

vi.mock("../src/core/renderable.js", () => {
  class StubRenderable {
    isDestroyed = false
    visible = true
    parent = null
    ctx: unknown
    once = vi.fn()
    off = vi.fn()
    on = vi.fn()

    constructor(ctx: unknown) {
      this.ctx = ctx
    }
  }

  return { Renderable: StubRenderable, RenderableEvents: { DESTROYED: "destroyed" } }
})

import { Renderable } from "../src/core/renderable.js"
import { CommandRegistry } from "../src/lib/commands.js"

const makeRenderer = (): any => ({
  isDestroyed: false,
  once: vi.fn(),
  off: vi.fn(),
  root: {},
  currentFocusedRenderable: null,
})

const makeTarget = (renderer: unknown): any => new (Renderable as any)(renderer)

describe("CommandRegistry.dispose", () => {
  test("a throwing change listener cannot abort teardown", () => {
    const renderer = makeRenderer()
    const registry = CommandRegistry.forRenderer(renderer)
    const target1 = makeTarget(renderer)
    const target2 = makeTarget(renderer)
    registry.register({ id: "one", title: "One", run: () => {} }, target1)
    registry.register({ id: "two", title: "Two", run: () => {} }, target2)
    registry.on("change", () => {
      throw new Error("listener boom")
    })
    expect(() => registry.dispose()).not.toThrow()
    expect(target1.off).toHaveBeenCalledWith("destroyed", expect.any(Function))
    expect(target2.off).toHaveBeenCalledWith("destroyed", expect.any(Function))
    expect(renderer.off).toHaveBeenCalledWith("destroy", expect.any(Function))
    expect(CommandRegistry.forRenderer(renderer)).not.toBe(registry)
  })

  test("dispose emits a single change and stays disposed", async () => {
    const renderer = makeRenderer()
    const registry = CommandRegistry.forRenderer(renderer)
    registry.register({ id: "a", title: "A", run: () => {} })
    registry.register({ id: "b", title: "B", run: () => {} })
    let changes = 0
    registry.on("change", () => {
      changes++
    })
    registry.dispose()
    expect(changes).toBe(1)
    registry.dispose()
    expect(changes).toBe(1)
    expect(await registry.execute("a")).toEqual({ status: "disposed" })
  })
})
