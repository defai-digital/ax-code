import { describe, expect, test } from "vitest"
import { braces, checkBracesDepthGuard } from "./check-braces-depth-guard.mjs"

describe("installed braces dependency depth guards", () => {
  test.each(["parse", "compile", "expand", "stringify"])(
    "%s rejects deeply nested patterns without stack overflow",
    (method) => {
      const pattern = "{".repeat(4000) + "a,b" + "}".repeat(4000)
      expect(() => braces[method](pattern)).toThrow(SyntaxError)
    },
  )

  test("the pre-scan guard covers parentheses, supplied ASTs and ordinary glob behavior", () => {
    expect(() => checkBracesDepthGuard()).not.toThrow()
  })
})

test("the installed registry patch retains the input-length guard for imbalanced patterns", () => {
  const pattern = "}".repeat(10001)
  expect(() => braces.parse(pattern)).toThrow(/exceeds max characters/)
  expect(() => braces.parse(pattern, { maxLength: Infinity })).toThrow(/exceeds max characters/)
})
