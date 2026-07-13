/**
 * Multi-mode ensemble harness eval — CI-callable pure-policy suite (ADR-049).
 *
 * Run:
 *   pnpm exec vitest run test/harness/multi-mode-ensemble-eval.test.ts
 */
import { describe, expect, test } from "vitest"
import { ModePolicy } from "../../src/mode/policy"
import { Hybrid } from "../../src/mode/hybrid"
import { Council } from "../../src/mode/council"
import { Arena } from "../../src/mode/arena"
import { Debate } from "../../src/mode/debate"
import { Budget } from "../../src/mode/budget"
import { WorktreePolicy } from "../../src/mode/worktree-policy"
import { ImplementArena } from "../../src/mode/implement-arena"
import { ModeMemory } from "../../src/mode/memory"

describe("multi-mode-ensemble-eval", () => {
  test("hybrid escalates high complexity to cloud when local available", () => {
    const place = Hybrid.recommendPlacement({
      localAvailable: true,
      complexity: "high",
      escalateOnHighComplexity: true,
    })
    expect(place.placement).toBe("cloud")

    const decision = ModePolicy.resolveMode(
      { default: "hybrid", hybrid: { escalateOnHighComplexity: true } },
      {
        localAvailable: true,
        connectedProviderIDs: ["ax-engine", "google"],
        complexity: "high",
      },
    )
    expect(decision.mode).toBe("hybrid")
    expect(decision.placement).toBe("cloud")
  })

  test("council consensus beats singleton for shared issues", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "a",
        providerID: "google",
        modelID: "g",
        issues: [
          {
            memberId: "a",
            severity: "high",
            category: "security",
            location: "auth.ts:1",
            summary: "Missing rate limit",
          },
        ],
      },
      {
        memberId: "b",
        providerID: "openrouter",
        modelID: "o",
        issues: [
          {
            memberId: "b",
            severity: "high",
            category: "security",
            location: "auth.ts:1",
            summary: "Missing rate limit",
          },
        ],
      },
      {
        memberId: "c",
        providerID: "groq",
        modelID: "q",
        issues: [
          {
            memberId: "c",
            severity: "high",
            category: "security",
            location: "auth.ts:1",
            summary: "Missing rate limit",
          },
          {
            memberId: "c",
            severity: "low",
            category: "style",
            summary: "Naming nit only me",
          },
        ],
      },
    ])
    expect(report.incomplete).toBe(false)
    expect(report.consensus.length).toBe(1)
    expect(report.singleton.some((i) => i.summary.includes("Naming"))).toBe(true)
  })

  test("arena ranking rejects pure popularity over verification", () => {
    const ranked = Arena.rankArenaCandidates(
      [
        {
          id: "popular-wrong",
          providerID: "a",
          modelID: "1",
          verification: "fail",
          popularity: 100,
          riskScore: 1,
        },
        {
          id: "correct",
          providerID: "b",
          modelID: "2",
          verification: "pass",
          popularity: 0,
          riskScore: 8,
        },
      ],
      "hybrid_score",
    )
    expect(ranked[0]!.id).toBe("correct")
  })

  test("implement arena preserves worktree metadata on rank", () => {
    const ranked = ImplementArena.rank([
      {
        id: "p/m",
        providerID: "p",
        modelID: "m",
        completed: true,
        verification: "pass",
        changedFiles: 1,
        worktreeDirectory: "/tmp/arena-wt",
        worktreeBranch: "ax-code/arena-p",
      },
      {
        id: "q/n",
        providerID: "q",
        modelID: "n",
        completed: true,
        verification: "fail",
        changedFiles: 1,
      },
    ])
    expect(ranked[0]!.worktreeDirectory).toBe("/tmp/arena-wt")
    expect(ranked[0]!.verification).toBe("pass")
  })

  test("worktree policy allows multi-writer only under worktree isolation", () => {
    const writers = [
      { name: "build", permission: [{ permission: "*", pattern: "*", action: "allow" as const }] },
      { name: "debug", permission: [{ permission: "*", pattern: "*", action: "allow" as const }] },
    ]
    expect(WorktreePolicy.evaluate({ agents: writers, isolation: "shared" }).ok).toBe(false)
    expect(WorktreePolicy.evaluate({ agents: writers, isolation: "worktree" }).ok).toBe(true)
  })

  test("budget fail-closes when USD cannot fund arena", () => {
    const r = Budget.check({
      kind: "arena",
      requestedMembers: 3,
      budget: {
        maxMembers: 3,
        maxContestants: 3,
        timeoutMs: 1000,
        maxEstimatedUsd: 0.01,
        estimatedUsdPerMember: 0.05,
      },
    })
    expect(r.ok).toBe(false)
  })

  test("debate synthesis is anonymous", () => {
    const report = Council.aggregateCouncil([
      {
        memberId: "brand-a",
        providerID: "google",
        modelID: "g",
        issues: [
          {
            memberId: "brand-a",
            severity: "high",
            category: "security",
            summary: "Issue one",
          },
        ],
      },
      {
        memberId: "brand-b",
        providerID: "openrouter",
        modelID: "o",
        issues: [
          {
            memberId: "brand-b",
            severity: "high",
            category: "security",
            summary: "Issue one",
          },
        ],
      },
    ])
    const prompt = Debate.renderSynthesisPrompt(Debate.buildAnonymousSynthesis(report, 1))
    expect(prompt).toContain("anonymous")
    expect(prompt).not.toContain("brand-a")
    expect(prompt).not.toContain("brand-b")
  })

  test("memory bias prefers historical winners", () => {
    const stats = ModeMemory.aggregateStats([
      {
        taskClass: "implement",
        providerID: "strong",
        modelID: "x",
        result: "win",
        at: 1,
      },
      {
        taskClass: "implement",
        providerID: "weak",
        modelID: "y",
        result: "fail",
        at: 2,
      },
    ])
    const ordered = ModeMemory.biasByMemory(
      [
        { providerID: "weak", modelID: "y" },
        { providerID: "strong", modelID: "x" },
      ],
      stats,
    )
    expect(ordered[0]!.providerID).toBe("strong")
  })
})
