import { describe, expect, test } from "vitest"
import { Council } from "../../src/mode/council"
import { Debate } from "../../src/mode/debate"

describe("anonymous synthesis participant coverage", () => {
  test("redacts a silent member named in another member's finding", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "brand-a/model-x",
        providerID: "brand-a",
        modelID: "model-x",
        issues: [
          {
            memberId: "brand-a/model-x",
            severity: "medium",
            category: "design",
            // Names a participant that raised no issues of its own.
            summary: "brand-b/model-y already validated this approach",
          },
        ],
      },
      {
        memberId: "brand-b/model-y",
        providerID: "brand-b",
        modelID: "model-y",
        issues: [],
      },
    ])

    const prompt = Debate.renderSynthesisPrompt(
      Debate.buildAnonymousSynthesis(report, 1, ["brand-a/model-x", "brand-b/model-y"]),
    )
    expect(prompt).not.toContain("brand-b")
    expect(prompt).not.toContain("model-y")
  })
})
