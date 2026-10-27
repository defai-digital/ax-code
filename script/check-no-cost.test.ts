import { describe, expect, test } from "vitest"
import { scanText } from "./check-no-cost"

const fields = (body: string) => [...scanText("x.ts", body)].filter((hit) => hit.pattern === "schema-field")

describe("check-no-cost schema-field", () => {
  test("flags a cost field that is not first in a one-line object", () => {
    expect(fields("const s = z.object({ name: z.string(), cost: z.number() })")).toHaveLength(1)
    expect(fields("const s = z.object({ cost: z.number() })")).toHaveLength(1)
  })

  test("still ignores cost parameters and declarations", () => {
    expect(fields("function f(a: string, cost: number) {}")).toHaveLength(0)
    expect(fields("const run = (cost: number) => cost")).toHaveLength(0)
    expect(fields("const cost: number = 5")).toHaveLength(0)
  })
})
