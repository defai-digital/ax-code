import { describe, expect, test } from "bun:test"
import { RiskView } from "../../src/cli/cmd/risk"

describe("RiskView.lines", () => {
  test("uses confidence wording instead of trust", () => {
    const lines = RiskView.lines({
      id: "ses_123",
      title: "Demo session",
      assessment: {
        level: "LOW",
        score: 12,
        readiness: "ready",
        confidence: 0.87,
        summary: "minimal change",
        signals: {
          filesChanged: 1,
          linesChanged: 10,
          totalTools: 2,
          apiEndpointsAffected: 0,
          crossModule: false,
          securityRelated: false,
          validationState: "passed",
          diffState: "clean",
        },
      },
      semantic: null,
      drivers: [],
    } as any)

    expect(lines).toContain("  Confidence: 87%")
    expect(lines.join("\n")).not.toContain("  Trust:")
  })
})
