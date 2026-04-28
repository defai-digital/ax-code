import { describe, expect, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { evaluate } from "../../src/memory/evaluation"
import { recordEntry } from "../../src/memory/recorder"

describe("memory.evaluation", () => {
  test("computes recall@k for expected memory names", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "real-db-tests",
      body: "Use real DB integration tests",
      tags: ["testing"],
    })
    await recordEntry(tmp.path, "feedback", {
      name: "docs-rule",
      body: "Docs use product language",
      pathGlobs: ["docs/**/*.md"],
    })

    const casesPath = path.join(tmp.path, "memory-cases.json")
    await Bun.write(
      casesPath,
      JSON.stringify({
        cases: [
          {
            name: "testing rule",
            query: "real tests",
            tags: ["testing"],
            expected: ["real-db-tests"],
          },
          {
            name: "wrong path",
            query: "docs",
            path: "src/app.ts",
            expected: ["docs-rule"],
          },
        ],
      }),
    )

    const report = await evaluate(tmp.path, { casesPath, limit: 3 })

    expect(report.total).toBe(2)
    expect(report.passed).toBe(1)
    expect(report.recallAtK).toBe(0.5)
    expect(report.meanReciprocalRank).toBe(0.5)
    expect(report.passedThreshold).toBe(true)
    expect(report.cases[0]?.hit).toBe(true)
    expect(report.cases[0]?.expectedRanks).toEqual([{ name: "real-db-tests", rank: 1 }])
    expect(report.cases[0]?.firstHitRank).toBe(1)
    expect(report.cases[0]?.reciprocalRank).toBe(1)
    expect(report.cases[1]?.missing).toEqual(["docs-rule"])
    expect(report.cases[1]?.expectedRanks).toEqual([{ name: "docs-rule", rank: null }])
    expect(report.cases[1]?.firstHitRank).toBeNull()
  })

  test("case limit and scope override defaults", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "project-rule",
      body: "project scoped rule",
    })

    const casesPath = path.join(tmp.path, "memory-cases.json")
    await Bun.write(
      casesPath,
      JSON.stringify({
        cases: [
          {
            query: "project",
            expected: ["project-rule"],
            limit: 1,
            scope: "project",
          },
        ],
      }),
    )

    const report = await evaluate(tmp.path, { casesPath, limit: 5, scope: "global" })

    expect(report.limit).toBe(5)
    expect(report.scope).toBe("global")
    expect(report.cases[0]?.limit).toBe(1)
    expect(report.cases[0]?.scope).toBe("project")
    expect(report.cases[0]?.hit).toBe(true)
  })

  test("reports threshold failure without hiding case details", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "available-rule",
      body: "available recall rule",
    })

    const casesPath = path.join(tmp.path, "memory-cases.json")
    await Bun.write(
      casesPath,
      JSON.stringify({
        cases: [
          {
            query: "available",
            expected: ["available-rule"],
          },
          {
            query: "missing",
            expected: ["missing-rule"],
          },
        ],
      }),
    )

    const report = await evaluate(tmp.path, { casesPath, limit: 3, minRecall: 0.75 })

    expect(report.recallAtK).toBe(0.5)
    expect(report.minRecall).toBe(0.75)
    expect(report.passedThreshold).toBe(false)
    expect(report.cases[1]?.missing).toEqual(["missing-rule"])
  })

  test("reports first-hit rank and mean reciprocal rank", async () => {
    await using tmp = await tmpdir()
    await recordEntry(tmp.path, "feedback", {
      name: "first-result",
      body: "shared ranking phrase",
      confidence: 1,
    })
    await recordEntry(tmp.path, "feedback", {
      name: "second-result",
      body: "shared ranking phrase",
      confidence: 0.5,
    })

    const casesPath = path.join(tmp.path, "memory-cases.json")
    await Bun.write(
      casesPath,
      JSON.stringify({
        cases: [
          {
            query: "shared ranking phrase",
            expected: ["second-result"],
          },
        ],
      }),
    )

    const report = await evaluate(tmp.path, { casesPath, limit: 5 })

    expect(report.meanReciprocalRank).toBe(0.5)
    expect(report.cases[0]?.expectedRanks).toEqual([{ name: "second-result", rank: 2 }])
    expect(report.cases[0]?.firstHitRank).toBe(2)
    expect(report.cases[0]?.reciprocalRank).toBe(0.5)
  })
})
