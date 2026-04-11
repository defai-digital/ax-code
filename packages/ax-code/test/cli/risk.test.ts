import { describe, expect, test } from "bun:test"
import { RiskView } from "../../src/cli/cmd/risk"
import { Risk } from "../../src/risk/score"

describe("risk view", () => {
  test("renders explainable risk output", () => {
    const assessment = Risk.assess({
      filesChanged: 4,
      linesChanged: 180,
      testCoverage: 0,
      apiEndpointsAffected: 1,
      crossModule: true,
      securityRelated: false,
      validationPassed: undefined,
      toolFailures: 1,
      totalTools: 3,
    })

    const lines = RiskView.lines(
      {
        id: "ses_1",
        title: "demo",
        assessment,
        drivers: Risk.explain(assessment),
        semantic: {
          headline: "refactor · demo.ts",
          risk: "medium",
          primary: "refactor",
          files: 1,
          additions: 12,
          deletions: 4,
          counts: [{ kind: "refactor", count: 1 }],
          signals: ["16 lines touched"],
          changes: [
            {
              file: "/tmp/demo.ts",
              status: "modified",
              kind: "refactor",
              risk: "medium",
              summary: "refactor · demo.ts",
              additions: 12,
              deletions: 4,
              signals: ["16 lines touched"],
            },
          ],
        },
      },
      true,
    )

    expect(lines.join("\n")).toContain("Session Risk")
    expect(lines.join("\n")).toContain("Risk:    HIGH")
    expect(lines.join("\n")).toContain("Ready:   needs validation")
    expect(lines.join("\n")).toContain("Trust:   37%")
    expect(lines.join("\n")).toContain("Change:   refactor · demo.ts (medium)")
    expect(lines.join("\n")).toContain("Breakdown")
    expect(lines.join("\n")).toContain("Evidence")
    expect(lines.join("\n")).toContain("Unknowns")
    expect(lines.join("\n")).toContain("Mitigations")
    expect(lines.join("\n")).toContain("Tool stability")
  })
})
