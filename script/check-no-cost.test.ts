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

describe("check-no-cost complete property names", () => {
  test("allows upstream model IDs ending in low-cost", () => {
    expect(
      fields(JSON.stringify({ "infer/gpt-6-astra:low-cost": { id: "infer/gpt-6-astra:low-cost", name: "Example" } })),
    ).toEqual([])
  })

  test("allows longer identifiers containing the cost suffix", () => {
    for (const body of ["const shape = { cpu_cost: number }", 'const shape = { "netcost": { type: "number" } }']) {
      expect(fields(body)).toEqual([])
    }
  })

  test("still catches bare and paired-quote cost fields", () => {
    for (const body of [
      'z.object({ "cost": z.number() })',
      "const shape = { 'cost': { value: 1 } }",
      "const shape = { cost: number }",
      '{"cost": "number"}',
    ]) {
      expect(fields(body)).toHaveLength(1)
    }
  })

  test("still rejects a cost field nested inside a model with a low-cost ID", () => {
    const hits = fields(JSON.stringify({ "infer/gpt-6-astra:low-cost": { cost: { input: 1 } } }))
    expect(hits).toHaveLength(1)
    expect(hits[0]?.snippet).toContain('"cost":')
  })
})
