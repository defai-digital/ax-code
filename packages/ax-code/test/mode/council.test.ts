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
})

describe("Council.aggregateCouncil", () => {
  test("classifies consensus majority singleton", () => {
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
    expect(report.singleton.some((i) => i.summary.includes("Naming") || i.summary.includes("nit"))).toBe(
      true,
    )
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
})
