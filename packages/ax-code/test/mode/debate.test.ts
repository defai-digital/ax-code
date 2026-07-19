import { describe, expect, test } from "vitest"
import { Council } from "../../src/mode/council"
import { Debate } from "../../src/mode/debate"

function reportFromMembers(count: number, consensusIssues = 1, singletonIssues = 1) {
  const members: Council.CouncilMemberResult[] = []
  for (let i = 0; i < count; i++) {
    const issues: Council.CouncilIssue[] = []
    for (let c = 0; c < consensusIssues; c++) {
      issues.push({
        memberId: `m${i}`,
        severity: "high",
        category: "security",
        location: "a.ts:1",
        summary: `Shared issue ${c}`,
      })
    }
    if (i === 0) {
      for (let s = 0; s < singletonIssues; s++) {
        issues.push({
          memberId: `m${i}`,
          severity: "medium",
          category: "style",
          summary: `Only me ${s}`,
        })
      }
    }
    members.push({
      memberId: `m${i}`,
      providerID: `p${i}`,
      modelID: "m",
      issues,
    })
  }
  return Council.aggregateCouncil(members)
}

describe("Debate", () => {
  test("caps configured debate rounds to the supported maximum", () => {
    expect(Debate.resolveMaxRounds(2)).toBe(2)
    expect(Debate.resolveMaxRounds(99)).toBe(3)
    expect(Debate.resolveMaxRounds(-1)).toBe(0)
    expect(Debate.resolveMaxRounds(Number.NaN)).toBe(0)
  })

  test("anonymous synthesis strips member ids from prompt text", () => {
    const report = reportFromMembers(3)
    const summary = Debate.buildAnonymousSynthesis(report, 1)
    const prompt = Debate.renderSynthesisPrompt(summary)
    expect(prompt).toContain("anonymous")
    expect(prompt).toContain("Chatham House")
    expect(prompt).not.toMatch(/\bm0\b/)
    expect(summary.issuesRaised.length).toBeGreaterThan(0)
  })

  test("redacts identities repeated inside member-authored findings", () => {
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
            summary: "brand-a/model-x recommends a queue",
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

    const prompt = Debate.renderSynthesisPrompt(Debate.buildAnonymousSynthesis(report, 1))
    expect(prompt).not.toContain("brand-a")
    expect(prompt).not.toContain("model-x")
    expect(prompt).toContain("[member]")
  })

  test("redacts short provider and model names without corrupting larger words", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "xai/o3",
        providerID: "xai",
        modelID: "o3",
        issues: [
          {
            memberId: "xai/o3",
            severity: "medium",
            category: "design",
            summary: "xAI and o3 recommend maintaining the queue",
          },
        ],
      },
      { memberId: "peer/model", providerID: "peer", modelID: "model", issues: [] },
    ])

    const prompt = Debate.renderSynthesisPrompt(Debate.buildAnonymousSynthesis(report, 1))
    expect(prompt.toLowerCase()).not.toContain("xai")
    expect(prompt).not.toContain("o3")
    expect(prompt).toContain("maintaining")
  })

  test("agreement ratio rewards consensus", () => {
    const report = reportFromMembers(3, 1, 0)
    // all members share the same issue → consensus only
    expect(Debate.agreementRatio(report)).toBe(1)
  })

  test("shouldContinueDebate stops when max rounds reached", () => {
    const report = reportFromMembers(3, 1, 2)
    const d = Debate.shouldContinueDebate({ round: 2, maxRounds: 2, report })
    expect(d.continue).toBe(false)
    expect(d.reason).toBe("max_rounds")
  })

  test("shouldContinueDebate continues when dissent remains", () => {
    const report = reportFromMembers(3, 1, 2)
    const d = Debate.shouldContinueDebate({ round: 0, maxRounds: 2, report })
    expect(d.continue).toBe(true)
  })

  test("does not declare convergence while a high-severity dissent remains", () => {
    const report = reportFromMembers(4, 4, 0)
    report.singleton.push({
      key: "high-dissent",
      tier: "singleton",
      severity: "high",
      category: "security",
      summary: "Potential credential exposure",
      memberIds: ["m0"],
      supportCount: 1,
      totalMembers: 4,
    })

    const decision = Debate.shouldContinueDebate({ round: 0, maxRounds: 2, report })
    expect(Debate.agreementRatio(report)).toBe(0.8)
    expect(decision.continue).toBe(true)
  })

  test("genericParts like 'labs', 'ai', 'engine', 'copilot' are NOT redacted from text", () => {
    // Member IDs whose parts include generic terms — the generic terms should survive redaction
    const report = Council.aggregateCouncil([
      {
        memberId: "acme-labs/engine-v2",
        providerID: "acme-labs",
        modelID: "engine-v2",
        issues: [
          {
            memberId: "acme-labs/engine-v2",
            severity: "medium",
            category: "design",
            summary: "The labs team built an ai engine with copilot support",
          },
        ],
      },
      {
        memberId: "other/provider",
        providerID: "other",
        modelID: "provider",
        issues: [],
      },
    ])

    const prompt = Debate.renderSynthesisPrompt(Debate.buildAnonymousSynthesis(report, 1))
    // Generic parts should survive — they are not specific enough to be identity-bearing
    expect(prompt.toLowerCase()).toContain("labs")
    expect(prompt.toLowerCase()).toContain("ai")
    expect(prompt.toLowerCase()).toContain("engine")
    expect(prompt.toLowerCase()).toContain("copilot")
    // The specific composite member id parts should not leak into the output
    // (they were never in the summary text, and the redaction logic would strip them if they were)
    expect(prompt).not.toContain("acme-labs")
    expect(prompt).not.toContain("engine-v2")
  })

  test("non-generic member name parts are still redacted even when combined with generic words", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "novacorp/ai-gpt",
        providerID: "novacorp",
        modelID: "ai-gpt",
        issues: [
          {
            memberId: "novacorp/ai-gpt",
            severity: "high",
            category: "security",
            summary: "novacorp and ai-gpt found a critical auth bypass",
          },
        ],
      },
      {
        memberId: "peer/model",
        providerID: "peer",
        modelID: "model",
        issues: [],
      },
    ])

    const prompt = Debate.renderSynthesisPrompt(Debate.buildAnonymousSynthesis(report, 1))
    // "novacorp" and "ai-gpt" are specific enough to be redacted
    expect(prompt.toLowerCase()).not.toContain("novacorp")
    expect(prompt).not.toContain("ai-gpt")
    // The standalone generic word "ai" in the summary should survive
    expect(prompt).toContain("[member]")
  })
})
