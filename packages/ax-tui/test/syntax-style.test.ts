import { beforeEach, expect, test, vi } from "vitest"
import { resolveRenderLib } from "../src/core/zig.js"
import { SyntaxStyle } from "../src/core/syntax-style.js"

vi.mock("../src/core/zig.js", () => ({ resolveRenderLib: vi.fn() }))
vi.mock("../src/core/utils.js", () => ({ createTextAttributes: () => 0 }))

let nextId = 1
const lib = {
  createSyntaxStyle: vi.fn(),
  syntaxStyleRegister: vi.fn(),
  destroySyntaxStyle: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  nextId = 1
  vi.mocked(resolveRenderLib).mockReturnValue(lib as never)
  lib.createSyntaxStyle.mockReturnValue(1 as never)
  lib.syntaxStyleRegister.mockImplementation(() => nextId++)
})

test("merge cache keeps a scoped style name distinct from a merge path", () => {
  const style = SyntaxStyle.fromStyles({
    a: { bold: true },
    b: { italic: true },
    "a:b": { fg: "#ff0000" },
  })

  const merged = style.mergeStyles("a", "b")
  expect(merged.fg).toBeUndefined()

  const scoped = style.mergeStyles("a:b")
  expect(scoped.fg?.toInts()).toEqual([255, 0, 0, 255])
  expect(style.getCacheSize()).toBe(2)

  style.destroy()
})

test("repeated merges reuse the cached result", () => {
  const style = SyntaxStyle.fromStyles({ a: { bold: true }, b: { italic: true } })

  const first = style.mergeStyles("a", "b")
  const second = style.mergeStyles("a", "b")
  expect(second).toBe(first)
  expect(style.getCacheSize()).toBe(1)

  style.destroy()
})
