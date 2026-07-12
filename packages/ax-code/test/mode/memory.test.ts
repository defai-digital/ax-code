import { describe, expect, test } from "vitest"
import { ModeMemory } from "../../src/mode/memory"

describe("ModeMemory pure helpers", () => {
  test("classifyTask detects security", () => {
    expect(ModeMemory.classifyTask("scan for XSS vulnerabilities")).toBe("security")
  })

  test("aggregateStats ranks winners", () => {
    const stats = ModeMemory.aggregateStats(
      [
        {
          taskClass: "implement",
          providerID: "google",
          modelID: "a",
          result: "win",
          at: 1,
        },
        {
          taskClass: "implement",
          providerID: "google",
          modelID: "a",
          result: "win",
          at: 2,
        },
        {
          taskClass: "implement",
          providerID: "openrouter",
          modelID: "b",
          result: "fail",
          at: 3,
        },
      ],
      "implement",
    )
    expect(stats[0]!.providerID).toBe("google")
    expect(stats[0]!.wins).toBe(2)
    expect(stats[0]!.score).toBeGreaterThan(stats[1]!.score)
  })

  test("biasByMemory reorders candidates", () => {
    const stats: ModeMemory.Stats[] = [
      {
        providerID: "weak",
        modelID: "x",
        wins: 0,
        places: 0,
        fails: 2,
        participates: 0,
        score: -2,
      },
      {
        providerID: "strong",
        modelID: "y",
        wins: 3,
        places: 0,
        fails: 0,
        participates: 0,
        score: 9,
      },
    ]
    const ordered = ModeMemory.biasByMemory(
      [
        { providerID: "weak", modelID: "x" },
        { providerID: "strong", modelID: "y" },
      ],
      stats,
    )
    expect(ordered[0]!.providerID).toBe("strong")
  })
})
