import { describe, expect, test } from "vitest"
import path from "node:path"
import { EnsembleEval } from "../../src/mode/ensemble-eval"

// ADR-102: every golden fixture must pass against the current constants.
// Changing a tier, merge, ranking, or judge-mapping constant without
// updating these fixtures fails loudly here instead of drifting silently.
const fixtureDir = path.join(__dirname, "fixtures", "ensemble-eval")
const cases = EnsembleEval.loadCases(fixtureDir)

describe("EnsembleEval golden fixtures", () => {
  test("fixture directory is non-empty and schema-valid", () => {
    expect(cases.length).toBeGreaterThanOrEqual(14)
    const kinds = new Set(cases.map((c) => c.kind))
    expect([...kinds].sort()).toEqual(["arena-rank", "council-aggregate", "debate-convergence", "judge-map"])
  })

  for (const c of cases) {
    test(`${c.kind}: ${c.name}`, () => {
      const result = EnsembleEval.evaluate(c)
      expect(result.failures).toEqual([])
      expect(result.pass).toBe(true)
    })
  }
})
