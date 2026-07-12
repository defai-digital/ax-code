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
  test("anonymous synthesis strips member ids from prompt text", () => {
    const report = reportFromMembers(3)
    const summary = Debate.buildAnonymousSynthesis(report, 1)
    const prompt = Debate.renderSynthesisPrompt(summary)
    expect(prompt).toContain("anonymous")
    expect(prompt).toContain("Chatham House")
    expect(prompt).not.toMatch(/\bm0\b/)
    expect(summary.issuesRaised.length).toBeGreaterThan(0)
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
})
