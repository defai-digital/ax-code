import { describe, expect, test, vi } from "vitest"

// Headless stub of the native-backed Renderable base: truncation and gutter
// width math live in the subclasses, not in the native base class.
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
    remove(_id: unknown): void {}
  }

  return { Renderable: StubRenderable }
})

import { TabSelectRenderable } from "../src/renderables/TabSelect.js"
import { LineNumberRenderable } from "../src/renderables/LineNumberRenderable.js"

const ctx = { on: () => {}, off: () => {} } as never

describe("TabSelect truncation respects display width", () => {
  const tab = new TabSelectRenderable(ctx, { options: [] })
  const truncate = (text: string, maxWidth: number): string => tab["truncateText"](text, maxWidth)

  test("wide characters are truncated by cell width, not UTF-16 length", () => {
    // 4 CJK chars = 8 cells; a 5-cell budget fits 2 chars (4 cells) + ellipsis.
    expect(truncate("你好世界", 5)).toBe("你好…")
  })

  test("astral characters are never split into lone surrogates", () => {
    expect(truncate("𝕒𝕓𝕔", 2)).toBe("𝕒…")
  })

  test("a zero budget yields an empty string, not a stray ellipsis", () => {
    expect(truncate("abc", 0)).toBe("")
  })

  test("text that fits is returned unchanged", () => {
    expect(truncate("abc", 3)).toBe("abc")
    expect(truncate("你好", 4)).toBe("你好")
  })

  test("ASCII truncation keeps the ellipsis inside the budget", () => {
    expect(truncate("abcd", 3)).toBe("ab…")
  })
})

describe("LineNumber gutter width covers negative line numbers", () => {
  const makeTarget = (virtualLineCount: number) =>
    ({ virtualLineCount, scrollY: 0, on() {}, off() {}, id: "target" }) as never

  const gutterWidth = (options: Record<string, unknown>): number => {
    const ln = new LineNumberRenderable(ctx, options as never)
    return ln["gutter"]["calculateWidth"]()
  }

  test("a negative offset widens the gutter for the sign and first line number", () => {
    // Lines -4..5: widest label "-4" needs 2 digits + padding 1 + left pad 1.
    expect(gutterWidth({ target: makeTarget(10), lineNumberOffset: -5 })).toBe(4)
  })

  test("large negative offsets size the gutter from the absolute magnitude", () => {
    // Lines -99..-90: "-99" needs 3 digits + padding 1 + left pad 1.
    expect(gutterWidth({ target: makeTarget(10), lineNumberOffset: -100 })).toBe(5)
  })

  test("custom negative line numbers widen the gutter", () => {
    expect(
      gutterWidth({ target: makeTarget(5), lineNumbers: new Map([[0, -12]]) }),
    ).toBe(5)
  })

  test("positive numbering keeps the previous width", () => {
    expect(gutterWidth({ target: makeTarget(100) })).toBe(5)
  })
})

describe("LineNumber line color configs", () => {
  const makeLineNumber = (lineColors: Map<number, unknown>) => new LineNumberRenderable(ctx, { lineColors } as never)

  test("content-only config colors the content without leaking into the gutter", () => {
    const ln = makeLineNumber(new Map([[1, { content: "#ff0000" }]]))
    expect(ln["_lineColorsContent"].get(1)?.r).toBe(1)
    expect(ln["_lineColorsGutter"].has(1)).toBe(false)
  })

  test("gutter and content channels are parsed independently", () => {
    const ln = makeLineNumber(new Map([[2, { gutter: "#0000ff", content: "#ff0000" }]]))
    expect(ln["_lineColorsGutter"].get(2)?.b).toBe(1)
    expect(ln["_lineColorsContent"].get(2)?.r).toBe(1)
  })

  test("gutter-only config darkens the content channel", () => {
    const ln = makeLineNumber(new Map([[3, { gutter: "#00ff00" }]]))
    expect(ln["_lineColorsGutter"].get(3)?.g).toBe(1)
    expect(ln["_lineColorsContent"].get(3)?.g).toBeCloseTo(0.8)
  })

  test("plain color strings apply to both channels", () => {
    const ln = makeLineNumber(new Map([[4, "#00ff00"]]))
    expect(ln["_lineColorsGutter"].get(4)?.g).toBe(1)
    expect(ln["_lineColorsContent"].get(4)?.g).toBeCloseTo(0.8)
  })

  test("setLineColor with a content-only config clears the stale gutter entry", () => {
    const ln = makeLineNumber(new Map([[1, "#ff0000"]]))
    expect(ln["_lineColorsGutter"].has(1)).toBe(true)

    ln.setLineColor(1, { content: "#00ff00" })

    expect(ln["_lineColorsGutter"].has(1)).toBe(false)
    expect(ln["_lineColorsContent"].get(1)?.g).toBe(1)
  })

  test("setLineColor with an empty config clears both channels", () => {
    const ln = makeLineNumber(new Map([[1, "#ff0000"]]))

    ln.setLineColor(1, {})

    expect(ln["_lineColorsGutter"].has(1)).toBe(false)
    expect(ln["_lineColorsContent"].has(1)).toBe(false)
  })
})