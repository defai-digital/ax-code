import { describe, expect, test, vi } from "vitest"

// Headless stub with accessors two prototype levels below the leaf construct,
// mirroring Text -> TextBuffer -> Renderable in the real hierarchy.
vi.mock("../src/core/renderable.js", () => {
  class StubRenderable {
    _visible = true
    _opacity = 1
    yogaNode: any = undefined

    constructor(_ctx: unknown, _options?: unknown) {}

    get visible(): boolean {
      return this._visible
    }

    set visible(value: boolean) {
      this._visible = value
    }

    get opacity(): number {
      return this._opacity
    }

    set opacity(value: number) {
      this._opacity = value
    }

    get primaryAxis(): string {
      return this.yogaNode.getFlexDirection()
    }

    focus(): this {
      return this
    }

    blur(): this {
      return this
    }

    add(_child: unknown): void {}
  }

  return {
    Renderable: StubRenderable,
    isRenderable: (node: unknown) => node instanceof StubRenderable,
  }
})

import { Renderable } from "../src/core/renderable.js"
import { h, instantiate } from "../src/renderables/composition/vnode.js"

class Mid extends Renderable {}
class Leaf extends Mid {}

describe("vnode proxy setters on deep prototypes", () => {
  test("depth-2 setters queue property calls instead of dead own props", () => {
    const node = h(Leaf, {})
    node.visible = false
    node.opacity = 0.5
    const pending = node.__pendingCalls ?? []
    expect(pending).toContainEqual({ method: "visible", args: [false], isProperty: true })
    expect(pending).toContainEqual({ method: "opacity", args: [0.5], isProperty: true })
    const inst = instantiate({} as never, node)
    expect(inst.visible).toBe(false)
    expect((inst as unknown as { opacity: number }).opacity).toBe(0.5)
  })
})

describe("vnode proxy getters", () => {
  test("getters are not invoked against the prototype", () => {
    expect(() => h(Leaf, {}).primaryAxis).not.toThrow()
    expect(h(Leaf, {}).primaryAxis).toBeUndefined()
  })

  test("accessors are not wrapped as chaining methods", () => {
    expect(typeof h(Mid, {}).visible).not.toBe("function")
  })
})

describe("vnode proxy method chaining", () => {
  test("deep methods still queue and apply in order", () => {
    const node = h(Leaf, {})
    const chained = node.focus()
    expect(chained).toBe(node)
    chained.blur()
    expect(node.__pendingCalls).toEqual([
      { method: "focus", args: [] },
      { method: "blur", args: [] },
    ])
    const inst = instantiate({} as never, node)
    expect(inst).toBeDefined()
  })
})
