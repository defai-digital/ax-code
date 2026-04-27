import { describe, expect, test } from "bun:test"
import { Critic } from "../../src/quality/critic"
import type { Finding } from "../../src/quality/finding"

const makeFinding = (severity: Finding["severity"], extras: Partial<Finding> = {}): Finding => ({
  schemaVersion: 1,
  findingId: "0123456789abcdef",
  workflow: "review",
  category: "bug",
  severity,
  summary: `${severity} summary`,
  file: "src/foo.ts",
  anchor: { kind: "line", line: 42 },
  rationale: "because",
  evidence: [],
  suggestedNextAction: "fix it",
  ruleId: "axcode:critic-bug",
  source: { tool: "ax-code-critic", version: "1", runId: "run-1" },
  ...extras,
})

describe("Critic.classifyForReplan (PRD v4.2.1 P2-2)", () => {
  test("HIGH / CRITICAL always block regardless of budget", () => {
    const high = Critic.classifyForReplan([makeFinding("HIGH")], 0, 0)
    expect(high.block).toBe(true)
    if (high.block) expect(high.reason).toBe("blocking")

    const critical = Critic.classifyForReplan([makeFinding("CRITICAL")], 99, 1)
    expect(critical.block).toBe(true)
    if (critical.block) expect(critical.reason).toBe("blocking")
  })

  test("with budget=0 (legacy), MEDIUM does not block", () => {
    const decision = Critic.classifyForReplan([makeFinding("MEDIUM")], 0, 0)
    expect(decision.block).toBe(false)
  })

  test("with budget=1 and used=0, first MEDIUM blocks and reports remaining=0", () => {
    const decision = Critic.classifyForReplan([makeFinding("MEDIUM")], 0, 1)
    expect(decision.block).toBe(true)
    if (decision.block && decision.reason === "medium_budget") {
      expect(decision.remaining).toBe(0)
    } else {
      throw new Error("expected medium_budget block")
    }
  })

  test("once budget is exhausted, subsequent MEDIUMs pass through", () => {
    // used=1, budget=1 → exhausted → pass
    const decision = Critic.classifyForReplan([makeFinding("MEDIUM")], 1, 1)
    expect(decision.block).toBe(false)
  })

  test("LOW / INFO never block, even with budget", () => {
    const low = Critic.classifyForReplan([makeFinding("LOW")], 0, 5)
    expect(low.block).toBe(false)
    const info = Critic.classifyForReplan([makeFinding("INFO")], 0, 5)
    expect(info.block).toBe(false)
  })

  test("HIGH wins over MEDIUM even if both are present", () => {
    const decision = Critic.classifyForReplan([makeFinding("HIGH"), makeFinding("MEDIUM")], 0, 1)
    expect(decision.block).toBe(true)
    if (decision.block) expect(decision.reason).toBe("blocking")
  })

  test("budget>1 burns one attempt at a time", () => {
    // budget=3, used=0,1,2 should each block; used=3 should pass
    expect(Critic.classifyForReplan([makeFinding("MEDIUM")], 0, 3).block).toBe(true)
    expect(Critic.classifyForReplan([makeFinding("MEDIUM")], 1, 3).block).toBe(true)
    expect(Critic.classifyForReplan([makeFinding("MEDIUM")], 2, 3).block).toBe(true)
    expect(Critic.classifyForReplan([makeFinding("MEDIUM")], 3, 3).block).toBe(false)
  })

  test("empty findings never block", () => {
    expect(Critic.classifyForReplan([], 0, 5).block).toBe(false)
  })
})
