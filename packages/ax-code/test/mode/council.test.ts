import { describe, expect, test } from "vitest"
import { Council } from "../../src/mode/council"

describe("Council.normalizeSummary / issueKey", () => {
  test("normalizes punctuation and case", () => {
    expect(Council.normalizeSummary("  Foo, BAR!!! ")).toBe("foo bar")
  })

  test("issueKey groups similar issues despite case and harmless punctuation", () => {
    const a = Council.issueKey({
      location: "src/a.ts:10",
      category: "security",
      summary: "Hardcoded secret!",
    })
    const b = Council.issueKey({
      location: "Src/A.ts:10",
      category: "Security",
      summary: "hardcoded secret",
    })
    expect(a).toBe(b)
  })

  test("issueKey preserves code-significant punctuation", () => {
    const a = Council.issueKey({
      location: "src/a.ts:10",
      category: "security",
      summary: "Don't use `eval()` in auth.ts",
    })
    const b = Council.issueKey({
      location: "src/a.ts:10",
      category: "security",
      summary: "Don't use eval in auth.ts",
    })
    expect(a).not.toBe(b)
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

  test("merges paraphrased findings from different members into consensus", () => {
    // Real transcript shape: grok and codex flagged the same Set.add()
    // truthiness concern with different wording but near-identical fixes.
    const report = Council.aggregateCouncil([
      {
        memberId: "grok-build-cli/grok-build-cli",
        providerID: "grok-build-cli",
        modelID: "grok-build-cli",
        issues: [
          {
            memberId: "grok-build-cli/grok-build-cli",
            severity: "low",
            category: "maintainability",
            summary:
              "Side-effecting `filter` plus relying on `Set.add()` being truthy is correct but opaque; readers often miss why the expression is boolean.",
            suggestedFix:
              "Prefer an explicit predicate: `items.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true })`.",
          },
          {
            memberId: "grok-build-cli/grok-build-cli",
            severity: "low",
            category: "correctness",
            summary:
              "Items whose `id` is `undefined`/`null` (or otherwise identical) collapse to a single entry; missing ids are treated as one key.",
            suggestedFix: "If that is not intended, skip or key missing ids separately before inserting into `seen`.",
          },
        ],
      },
      {
        memberId: "codex-cli/gpt-5.6-sol",
        providerID: "codex-cli",
        modelID: "gpt-5.6-sol",
        issues: [
          {
            memberId: "codex-cli/gpt-5.6-sol",
            severity: "medium",
            category: "maintainability",
            summary:
              "The predicate relies on the truthy return value and side effect of Set.prototype.add, making the intent less obvious.",
            suggestedFix:
              "Use an explicit callback: items.filter(x => { if (seen.has(x.id)) return false; seen.add(x.id); return true })",
          },
        ],
      },
    ])

    expect(report.consensus).toHaveLength(1)
    expect(report.consensus[0]?.memberIds).toEqual(["codex-cli/gpt-5.6-sol", "grok-build-cli/grok-build-cli"])
    expect(report.consensus[0]?.supportCount).toBe(2)
    // Merge keeps the worst severity across members
    expect(report.consensus[0]?.severity).toBe("medium")
    // The unrelated correctness finding stays a singleton
    expect(report.singleton).toHaveLength(1)
    expect(report.singleton[0]?.category).toBe("correctness")
  })

  test("does not similarity-merge terse or unrelated findings", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "m1",
        providerID: "p1",
        modelID: "a",
        issues: [
          { memberId: "m1", severity: "high", category: "security", summary: "SQL injection" },
          { memberId: "m1", severity: "low", category: "style", summary: "Naming nit" },
        ],
      },
      {
        memberId: "m2",
        providerID: "p2",
        modelID: "b",
        issues: [
          { memberId: "m2", severity: "high", category: "security", summary: "XSS injection" },
          {
            memberId: "m2",
            severity: "low",
            category: "performance",
            summary:
              "The nested loop over all repository files re-reads every entry on each iteration of the outer scan.",
          },
        ],
      },
    ])

    // Terse summaries share too few tokens to merge; everything stays singleton.
    expect(report.consensus).toHaveLength(0)
    expect(report.singleton).toHaveLength(4)
  })

  test("does not similarity-merge findings anchored to different locations", () => {
    const summary =
      "The request handler awaits each provider sequentially instead of fanning out, so total latency is the sum of member latencies."
    const suggestedFix = "Fan the provider calls out with Promise.all and aggregate the settled results."
    const report = Council.aggregateCouncil([
      {
        memberId: "m1",
        providerID: "p1",
        modelID: "a",
        issues: [
          {
            memberId: "m1",
            severity: "medium",
            category: "performance",
            location: "src/a.ts:10",
            summary,
            suggestedFix,
          },
        ],
      },
      {
        memberId: "m2",
        providerID: "p2",
        modelID: "b",
        issues: [
          {
            memberId: "m2",
            severity: "medium",
            category: "performance",
            location: "src/b.ts:99",
            summary,
            suggestedFix,
          },
        ],
      },
    ])

    expect(report.consensus).toHaveLength(0)
    expect(report.singleton).toHaveLength(2)
  })

  test("issueTokens and tokenSimilarity expose the clustering primitives", () => {
    const a = Council.issueTokens({
      category: "maintainability",
      summary: "Relies on the truthy return of Set.add inside filter.",
      suggestedFix: "Use an explicit predicate with seen.has and seen.add.",
    })
    expect(a.has("truthy")).toBe(true)
    expect(a.has("the")).toBe(false)
    expect(Council.tokenSimilarity(a, a)).toBe(1)
    expect(Council.tokenSimilarity(a, new Set(["unrelated", "tokens"]))).toBe(0)
  })

  test("classifyMemberFailure distinguishes timeout and JSON schema errors", () => {
    expect(Council.classifyMemberFailure("timeout or aborted: AbortError")).toBe("timeout")
    expect(Council.classifyMemberFailure("timeout: member exceeded 60000ms")).toBe("timeout")
    expect(
      Council.classifyMemberFailure(
        "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'.",
      ),
    ).toBe("JSON schema requirement")
    expect(Council.classifyMemberFailure("rate limit exceeded 429")).toBe("rate limit")
  })

  test("classifyMemberFailure separates user aborts from timeouts", () => {
    expect(Council.classifyMemberFailure("aborted: This operation was aborted")).toBe("aborted")
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
        { providerID: "zhipuai", id: 2 },
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

describe("Council.providerFamily", () => {
  test("maps known providers to their canonical family", () => {
    expect(Council.providerFamily("anthropic")).toBe("anthropic")
    expect(Council.providerFamily("claude-code")).toBe("anthropic")
    expect(Council.providerFamily("openai")).toBe("openai")
    expect(Council.providerFamily("google")).toBe("google")
    expect(Council.providerFamily("gemini-3-pro")).toBe("google")
    expect(Council.providerFamily("xai")).toBe("grok")
    expect(Council.providerFamily("grok-build-cli")).toBe("grok")
    expect(Council.providerFamily("alibaba")).toBe("alibaba")
    expect(Council.providerFamily("qwen-max")).toBe("alibaba")
    expect(Council.providerFamily("zhipu")).toBe("zhipu")
    expect(Council.providerFamily("glm-4")).toBe("zhipu")
    expect(Council.providerFamily("ax-engine")).toBe("local")
    expect(Council.providerFamily("ollama")).toBe("local")
    expect(Council.providerFamily("groq")).toBe("groq")
    expect(Council.providerFamily("openrouter")).toBe("openrouter")
  })

  test("uses prefix-based matching, not exact substring", () => {
    // "codex" contains "code" but should still resolve to openai (via includes("codex"))
    expect(Council.providerFamily("codex-mini")).toBe("openai")
    // "github-copilot" exact match → openai
    expect(Council.providerFamily("github-copilot")).toBe("openai")
    // Case-insensitive: "Claude" with capital C still matches
    expect(Council.providerFamily("Claude-Sonnet")).toBe("anthropic")
    // "zai" prefix → zhipu
    expect(Council.providerFamily("zai-provider")).toBe("zhipu")
  })

  test("falls back to first path segment for unknown providers", () => {
    expect(Council.providerFamily("mistral-ai")).toBe("mistral")
    expect(Council.providerFamily("cohere_command")).toBe("cohere")
    expect(Council.providerFamily("perplexity")).toBe("perplexity")
    // Edge case: empty string after split returns the id itself
    expect(Council.providerFamily("unknown")).toBe("unknown")
  })
})
