import { describe, expect, test } from "vitest"
import {
  AUTONOMOUS_MAX_STEPS,
  GLOBAL_STEP_LIMIT,
  GOAL_TOTAL_STEP_HEADROOM,
} from "../../src/constants/session"
import {
  autonomyBudgetDiagnostics,
  formatAutonomyBudgetReport,
  resolveAutonomyBudget,
} from "../../src/session/autonomy-budget"
import {
  MAX_TOOL_ONLY_TURNS,
  TOOL_ONLY_TURN_NUDGE,
  promptLoopLimits,
} from "../../src/session/prompt-loop-config"

describe("resolveAutonomyBudget", () => {
  test("ships standard defaults with no config", () => {
    const b = resolveAutonomyBudget({})
    expect(b.profile).toBe("standard")
    expect(b.modelTurnsPerSegment).toBe(GLOBAL_STEP_LIMIT)
    expect(b.maxContinuations).toBe(3)
    expect(b.modelTurnsTotal).toBe(GLOBAL_STEP_LIMIT * 4)
    expect(b.modelTurnsTotalGoal).toBe(GLOBAL_STEP_LIMIT * GOAL_TOTAL_STEP_HEADROOM)
    expect(b.toolCallsPerSegment).toBe(AUTONOMOUS_MAX_STEPS)
    expect(b.toolCallRate).toEqual({ count: 30, windowSeconds: 10 })
    expect(b.toolOnly.maxTurns).toBe(MAX_TOOL_ONLY_TURNS)
    expect(b.toolOnly.nudge).toBe(TOOL_ONLY_TURN_NUDGE)
    expect(b.sources).toEqual([])
  })

  test("session.* fields are honored and recorded as sources", () => {
    const b = resolveAutonomyBudget({
      session: { max_steps: 42, max_continuations: 2, max_total_steps: 100 },
    } as any)
    expect(b.modelTurnsPerSegment).toBe(42)
    expect(b.maxContinuations).toBe(2)
    expect(b.modelTurnsTotal).toBe(100)
    expect(b.modelTurnsTotalSuperLong).toBe(100)
    expect(b.sources).toEqual(
      expect.arrayContaining(["session.max_steps", "session.max_continuations", "session.max_total_steps"]),
    )
  })

  test("autonomy.budget wins over session.* and experimental caps", () => {
    const b = resolveAutonomyBudget({
      session: { max_steps: 100 },
      experimental: { autonomous_caps: { steps: 200, files: 10 } },
      autonomy: {
        budget: {
          model_turns: { per_segment: 77, total: 300 },
          tool_calls: {
            per_segment: 111,
            rate: { count: 15, window_seconds: 5 },
            per_tool: { bash: 9 },
          },
          changes: { files_total: 3 },
        },
        stall: { tool_only_turns: 12, tool_only_nudge: 4, tool_only_final_nudge: 8 },
      },
    } as any)
    expect(b.modelTurnsPerSegment).toBe(77)
    expect(b.modelTurnsTotal).toBe(300)
    expect(b.toolCallsPerSegment).toBe(111)
    expect(b.filesTotal).toBe(3)
    expect(b.toolCallRate).toEqual({ count: 15, windowSeconds: 5 })
    expect(b.perTool.bash).toBe(9)
    expect(b.toolOnly).toEqual({ nudge: 4, finalNudge: 8, maxTurns: 12 })
    expect(b.sources).toEqual(
      expect.arrayContaining([
        "autonomy.budget.model_turns.per_segment",
        "autonomy.budget.model_turns.total",
        "autonomy.budget.tool_calls.per_segment",
        "autonomy.budget.tool_calls.rate.count",
        "autonomy.budget.changes.files_total",
        "autonomy.stall.tool_only_turns",
      ]),
    )
  })

  test("quick profile seeds tighter budgets", () => {
    const b = resolveAutonomyBudget({ autonomy: { profile: "quick" } } as any)
    expect(b.profile).toBe("quick")
    expect(b.modelTurnsPerSegment).toBe(80)
    expect(b.maxContinuations).toBe(1)
    expect(b.modelTurnsTotal).toBe(160)
    expect(b.toolOnly.maxTurns).toBe(20)
    expect(b.toolCallRate.count).toBe(20)
  })

  test("explicit budget field overrides profile seed", () => {
    const b = resolveAutonomyBudget({
      autonomy: {
        profile: "quick",
        budget: { model_turns: { per_segment: 200 } },
      },
    } as any)
    expect(b.modelTurnsPerSegment).toBe(200)
    expect(b.maxContinuations).toBe(1) // still from quick
  })
})

describe("promptLoopLimits + autonomy", () => {
  test("exposes resolved autonomy budget alongside pacing fields", () => {
    const limits = promptLoopLimits({
      autonomy: { budget: { model_turns: { per_segment: 50 }, continuations: 1 } },
    } as any)
    expect(limits.sessionStepLimit).toBe(50)
    expect(limits.maxContinuations).toBe(1)
    expect(limits.maxTotalSteps).toBe(100)
    expect(limits.autonomy.modelTurnsPerSegment).toBe(50)
  })
})

describe("format + diagnostics", () => {
  test("report includes effective pacing and sources", () => {
    const budget = resolveAutonomyBudget({
      autonomy: { profile: "long", budget: { tool_calls: { rate: { count: 40 } } } },
    } as any)
    const text = formatAutonomyBudgetReport({
      budget,
      agentName: "debug",
      agentSteps: 30,
      autonomous: true,
    })
    expect(text).toContain("Profile: long")
    expect(text).toContain("Active agent: debug")
    expect(text).toContain("Effective pacing denominator (TUI): 30")
    expect(text).toContain("40 calls / 10s")
  })

  test("diagnostics flags agent cap below session segment", () => {
    const budget = resolveAutonomyBudget({})
    const warnings = autonomyBudgetDiagnostics({ budget, agentSteps: 30 })
    expect(warnings.some((w) => w.includes("Agent step cap"))).toBe(true)
  })
})
