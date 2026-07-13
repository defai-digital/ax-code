import { describe, expect, test } from "vitest"
import { Council } from "../../src/mode/council"
import { CouncilTool } from "../../src/tool/council"

describe("council tool contract", () => {
  test("tool id is council", () => {
    expect(CouncilTool.id).toBe("council")
  })

  test("init exposes parameters and description", async () => {
    const init = await CouncilTool.init()
    expect(init.description.toLowerCase()).toContain("council")
    expect(init.parameters.shape.question).toBeDefined()
    expect(init.parameters.shape.kind).toBeDefined()
  })

  test("parameter schema rejects empty question", async () => {
    const init = await CouncilTool.init()
    expect(() => init.parameters.parse({ question: "" })).toThrow()
  })

  test("parameter schema accepts review payload", async () => {
    const init = await CouncilTool.init()
    const parsed = init.parameters.parse({
      question: "Is this auth design sound?",
      kind: "design",
      context: "function login() {}",
      providers: [{ providerID: "google", modelID: "gemini-flash" }],
    })
    expect(parsed.kind).toBe("design")
    expect(parsed.providers).toHaveLength(1)
  })

  test("explicit council selection rejects an empty or duplicate member list", async () => {
    const init = await CouncilTool.init()
    expect(() => init.parameters.parse({ question: "Review auth", providers: [] })).toThrow()
    expect(() =>
      init.parameters.parse({
        question: "Review auth",
        providers: [
          { providerID: "google", modelID: "gemini" },
          { providerID: "google", modelID: "gemini" },
        ],
      }),
    ).toThrow()
    expect(() =>
      init.parameters.parse({
        question: "Review auth",
        providers: [
          { providerID: "google", modelID: "gemini-flash" },
          { providerID: "google", modelID: "gemini-pro" },
        ],
      }),
    ).toThrow()
  })
})

describe("council aggregation used by tool", () => {
  test("aggregates injected member results without LLM", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "google/g",
        providerID: "google",
        modelID: "g",
        overall: "ok",
        issues: [
          {
            memberId: "google/g",
            severity: "high",
            category: "security",
            location: "auth.ts:1",
            summary: "Missing rate limit",
          },
        ],
      },
      {
        memberId: "openrouter/o",
        providerID: "openrouter",
        modelID: "o",
        overall: "concerns",
        issues: [
          {
            memberId: "openrouter/o",
            severity: "high",
            category: "security",
            location: "auth.ts:1",
            summary: "Missing rate limit",
          },
        ],
      },
    ])
    expect(report.consensus).toHaveLength(1)
    expect(report.incomplete).toBe(false)
    const md = Council.renderReportMarkdown(report)
    expect(md).toContain("Consensus")
  })
})
