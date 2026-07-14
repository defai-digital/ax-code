import { describe, expect, test } from "vitest"
import { Council } from "../../src/mode/council"

describe("Council.normalizeSummary / issueKey", () => {
  test("normalizes punctuation and case", () => {
    expect(Council.normalizeSummary("  Foo, BAR!!! ")).toBe("foo bar")
  })

  test("issueKey groups similar issues", () => {
    const a = Council.issueKey({
      location: "src/a.ts:10",
      category: "security",
      summary: "Hardcoded secret!",
    })
    const b = Council.issueKey({
      location: "src/a.ts:10",
      category: "Security",
      summary: "hardcoded secret",
    })
    expect(a).toBe(b)
  })

  test("issueKey does not collide for findings that differ after a long prefix", () => {
    const prefix = "same ".repeat(40)
    const a = Council.issueKey({ category: "correctness", summary: `${prefix}first failure` })
    const b = Council.issueKey({ category: "correctness", summary: `${prefix}second failure` })
    expect(a).not.toBe(b)
  })
})

describe("Council.aggregateCouncil", () => {
  test("classifies consensus, majority, minority, and singleton findings", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "m1",
        providerID: "google",
        modelID: "g",
        issues: [
          {
            memberId: "m1",
            severity: "high",
            category: "security",
            location: "a.ts:1",
            summary: "SQL injection",
          },
          {
            memberId: "m1",
            severity: "low",
            category: "style",
            summary: "Naming nit",
          },
        ],
      },
      {
        memberId: "m2",
        providerID: "openrouter",
        modelID: "o",
        issues: [
          {
            memberId: "m2",
            severity: "medium",
            category: "security",
            location: "a.ts:1",
            summary: "SQL injection",
          },
          {
            memberId: "m2",
            severity: "high",
            category: "correctness",
            summary: "Off-by-one",
          },
        ],
      },
      {
        memberId: "m3",
        providerID: "groq",
        modelID: "q",
        issues: [
          {
            memberId: "m3",
            severity: "high",
            category: "security",
            location: "a.ts:1",
            summary: "SQL injection",
          },
        ],
      },
    ])

    expect(report.incomplete).toBe(false)
    expect(report.successfulMembers).toBe(3)
    expect(report.consensus).toHaveLength(1)
    expect(report.consensus[0]!.summary.toLowerCase()).toContain("sql")
    expect(report.consensus[0]!.severity).toBe("high")
    expect(report.majority.length + report.singleton.length).toBeGreaterThan(0)
    expect(report.singleton.some((i) => i.summary.includes("Naming") || i.summary.includes("nit"))).toBe(true)
  })

  test("marks incomplete with fewer than two successes", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "m1",
        providerID: "google",
        modelID: "g",
        issues: [
          {
            memberId: "m1",
            severity: "high",
            category: "security",
            summary: "Issue",
          },
        ],
      },
      {
        memberId: "m2",
        providerID: "x",
        modelID: "y",
        issues: [],
        error: "timeout",
      },
    ])
    expect(report.incomplete).toBe(true)
    expect(report.memberErrors).toHaveLength(1)
    // Incomplete: all tiers collapse to singleton classification path
    expect(report.consensus).toHaveLength(0)

    const md = Council.renderReportMarkdown(report, "review me")
    expect(md).toContain("## Result status")
    expect(md).toContain("**Incomplete**")
    expect(md.toLowerCase()).toContain("unavailable")
    expect(md).toContain("timeout")
  })

  test("classifyMemberFailure distinguishes timeout and JSON schema errors", () => {
    expect(Council.classifyMemberFailure("timeout or aborted: AbortError")).toBe("timeout")
    expect(
      Council.classifyMemberFailure(
        "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'.",
      ),
    ).toBe("JSON schema requirement")
    expect(Council.classifyMemberFailure("rate limit exceeded 429")).toBe("rate limit")
  })

  test("requires strictly more than half of an even-sized council for majority", () => {
    const members: Council.CouncilMemberResult[] = Array.from({ length: 4 }, (_, index) => ({
      memberId: `m${index + 1}`,
      providerID: `p${index + 1}`,
      modelID: "model",
      issues:
        index < 2
          ? [
              {
                memberId: `m${index + 1}`,
                severity: "medium" as const,
                category: "correctness",
                summary: "Shared by exactly half",
              },
            ]
          : [],
    }))

    const split = Council.aggregateCouncil(members)
    expect(split.majority).toHaveLength(0)
    expect(split.minority[0]?.supportCount).toBe(2)

    members[2]!.issues.push({
      memberId: "m3",
      severity: "medium",
      category: "correctness",
      summary: "Shared by exactly half",
    })
    const strictMajority = Council.aggregateCouncil(members)
    expect(strictMajority.majority[0]?.supportCount).toBe(3)
  })

  test("renderReportMarkdown includes advisory footer", () => {
    const md = Council.renderReportMarkdown(
      Council.aggregateCouncil([
        { memberId: "a", providerID: "p", modelID: "m", issues: [] },
        { memberId: "b", providerID: "q", modelID: "n", issues: [] },
      ]),
      "Is this safe?",
    )
    expect(md).toContain("Is this safe?")
    expect(md.toLowerCase()).toContain("advisory")
  })
})

describe("Council.selectDiverseMembers", () => {
  test("prefers one per family", () => {
    const selected = Council.selectDiverseMembers(
      [
        { providerID: "google", id: 1 },
        { providerID: "gemini-cli", id: 2 },
        { providerID: "openrouter", id: 3 },
        { providerID: "claude-code", id: 4 },
      ],
      3,
    )
    expect(selected).toHaveLength(3)
    const families = selected.map((s) => Council.providerFamily(s.providerID))
    expect(new Set(families).size).toBe(3)
  })

  test("deduplicates repeated provider/model members", () => {
    const unique = Council.dedupeMembers([
      { providerID: "google", modelID: "gemini", id: 1 },
      { providerID: "google", modelID: "gemini", id: 2 },
      { providerID: "google", modelID: "gemini-pro", id: 3 },
    ])

    expect(unique.map((member) => member.id)).toEqual([1, 3])
  })
})
