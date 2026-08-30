import { describe, expect, test } from "vitest"
import {
  footerGoalChip,
  footerSessionStatusOrIdle,
  footerSubagentStatusView,
  footerTokenChip,
  hasActiveSubagentInSessionTree,
} from "@/cli/cmd/tui/routes/session/footer-view-model"

describe("footerTokenChip", () => {
  test("returns undefined when no tokens", () => {
    expect(footerTokenChip({})).toBeUndefined()
    expect(footerTokenChip({ tokens: { input: 0, output: 0 } })).toBeUndefined()
  })

  test("formats small counts without suffix", () => {
    expect(footerTokenChip({ tokens: { input: 480, output: 120 } })).toEqual({ input: "480", output: "120" })
  })

  test("uses 1-decimal k for 1k-10k range", () => {
    expect(footerTokenChip({ tokens: { input: 2100, output: 480 } })).toEqual({ input: "2.1k", output: "480" })
  })

  test("rounds to whole k above 10k", () => {
    expect(footerTokenChip({ tokens: { input: 12_500, output: 31_900 } })).toEqual({ input: "13k", output: "32k" })
  })

  test("promotes rounded 1000k values to millions", () => {
    expect(footerTokenChip({ tokens: { input: 999_499, output: 999_500 } })).toEqual({
      input: "999k",
      output: "1.0m",
    })
    expect(footerTokenChip({ tokens: { input: 1_500_000, output: 0 } })).toEqual({
      input: "1.5m",
      output: "0",
    })
  })

  test("renders even when only one side is non-zero", () => {
    expect(footerTokenChip({ tokens: { input: 0, output: 100 } })).toEqual({ input: "0", output: "100" })
  })

  test("no rate when startedAt is missing (turn already settled)", () => {
    expect(footerTokenChip({ tokens: { input: 500, output: 200 } })).toEqual({ input: "500", output: "200" })
  })

  test("no rate when elapsed window is sub-second (avoids inf t/s flash)", () => {
    // 200ms after start, 50 tokens — too noisy to surface
    const startedAt = 1_700_000_000_000
    expect(footerTokenChip({ tokens: { input: 100, output: 50 }, startedAt, now: startedAt + 200 })).toEqual({
      input: "100",
      output: "50",
    })
  })

  test("rate uses 1-decimal when <100 t/s", () => {
    // 5s elapsed, 200 output → 40 t/s
    const startedAt = 1_700_000_000_000
    expect(footerTokenChip({ tokens: { input: 1000, output: 200 }, startedAt, now: startedAt + 5_000 })).toEqual({
      input: "1.0k",
      output: "200",
      rate: "40.0 t/s",
    })
  })

  test("rate uses whole number when >=100 t/s", () => {
    // 4s elapsed, 500 output → 125 t/s
    const startedAt = 1_700_000_000_000
    expect(footerTokenChip({ tokens: { input: 800, output: 500 }, startedAt, now: startedAt + 4_000 })).toEqual({
      input: "800",
      output: "500",
      rate: "125 t/s",
    })
  })

  test("no rate when output tokens still zero (only input staged)", () => {
    const startedAt = 1_700_000_000_000
    expect(footerTokenChip({ tokens: { input: 1500, output: 0 }, startedAt, now: startedAt + 3_000 })).toEqual({
      input: "1.5k",
      output: "0",
    })
  })

  test("rate from parts uses finished steps' decode windows (no tool-time decay)", () => {
    const startedAt = 1_700_000_000_000
    // One finished step decoded 100 tokens in 1s, then a 56s tool ran and the
    // in-flight second step has no usage yet. Wall-clock math over the 60s
    // turn would report ~1.7 t/s and keep decaying; the step-aware rate is a
    // stable 100 t/s.
    expect(
      footerTokenChip({
        tokens: { input: 10_000, output: 100 },
        startedAt,
        now: startedAt + 60_000,
        parts: [
          { type: "step-start" },
          { type: "text", time: { start: startedAt + 1_000, end: startedAt + 2_000 } },
          { type: "tool", state: { status: "completed", time: { start: startedAt + 2_000, end: startedAt + 58_000 } } },
          { type: "step-finish", tokens: { input: 10_000, output: 100 } },
          { type: "step-start" },
        ],
      }),
    ).toEqual({ input: "10k", output: "100", rate: "100 t/s" })
  })

  test("parts without step data fall back to the wall-clock window", () => {
    const startedAt = 1_700_000_000_000
    expect(
      footerTokenChip({
        tokens: { input: 1000, output: 200 },
        startedAt,
        now: startedAt + 5_000,
        parts: [{ type: "text", time: { start: startedAt + 1_000, end: startedAt + 5_000 } }],
      }),
    ).toEqual({ input: "1.0k", output: "200", rate: "40.0 t/s" })
  })
})

describe("footerGoalChip", () => {
  test("hides when no goal is set", () => {
    expect(footerGoalChip({ goal: null })).toBeUndefined()
  })

  test("renders active goal with token budget", () => {
    expect(
      footerGoalChip({
        goal: {
          objective: "finish all phases",
          status: "active",
          tokensUsed: 1200,
          tokenBudget: 2400,
        },
      }),
    ).toEqual({
      label: "Goal: finish all phases · 1.2k/2.4k tok",
      tone: "working",
      resumeHint: undefined,
    })
  })

  test("adds resume hint for paused and blocked goals", () => {
    expect(
      footerGoalChip({
        goal: {
          objective: "wait for user input",
          status: "blocked",
        },
      })?.label,
    ).toBe("Goal blocked: wait for user input · /goal resume")
  })

  test("omits the resume hint when the token budget is exhausted", () => {
    const chip = footerGoalChip({
      goal: {
        objective: "stop at the budget",
        status: "blocked",
        tokensUsed: 100,
        tokenBudget: 100,
        remainingTokens: 0,
      },
    })
    expect(chip?.resumeHint).toBeUndefined()
    expect(chip?.label).not.toContain("/goal resume")
  })

  test("compact mode drops the resume hint and the tok suffix", () => {
    const chip = footerGoalChip({
      compact: true,
      goal: {
        objective: "wait for user input",
        status: "paused",
        tokensUsed: 1200,
        tokenBudget: 2400,
      },
    })
    expect(chip).toEqual({
      label: "Goal paused: wait for user input · 1.2k/2.4k",
      tone: "warning",
      resumeHint: undefined,
    })
  })

  test("compact mode keeps goals without a budget short", () => {
    expect(
      footerGoalChip({
        compact: true,
        goal: { objective: "finish all phases", status: "active" },
      }),
    ).toEqual({
      label: "Goal: finish all phases",
      tone: "working",
      resumeHint: undefined,
    })
  })
})

describe("footerSessionStatusOrIdle", () => {
  test("preserves idle", () => {
    expect(footerSessionStatusOrIdle({ type: "idle" })).toEqual({ type: "idle" })
  })

  test("preserves valid status values", () => {
    expect(footerSessionStatusOrIdle({ type: "busy", waitState: "tool", activeTool: "bash" })).toEqual({
      type: "busy",
      waitState: "tool",
      activeTool: "bash",
    })
    expect(footerSessionStatusOrIdle({ type: "retry", attempt: 1, message: "x", next: 100 })).toEqual({
      type: "retry",
      attempt: 1,
      message: "x",
      next: 100,
    })
  })

  test("falls back to idle for invalid status values", () => {
    expect(footerSessionStatusOrIdle({ type: "retry", attempt: "1", message: "x", next: 100 })).toEqual({
      type: "idle",
    })
    expect(footerSessionStatusOrIdle({ type: "running" })).toEqual({ type: "idle" })
    expect(footerSessionStatusOrIdle(undefined)).toEqual({ type: "idle" })
    expect(footerSessionStatusOrIdle("idle")).toEqual({ type: "idle" })
  })
})

describe("hasActiveSubagentInSessionTree", () => {
  const parent = { id: "ses_parent" }
  const child = { id: "ses_child", parentID: "ses_parent" }
  const other = { id: "ses_other" }

  test("returns true while a child session is busy (goal plan writer case)", () => {
    expect(
      hasActiveSubagentInSessionTree({
        sessions: [parent, child, other],
        statuses: { ses_parent: { type: "idle" }, ses_child: { type: "busy" } },
        parentSessionID: "ses_parent",
      }),
    ).toBe(true)
  })

  test("returns true while a child session is retrying", () => {
    expect(
      hasActiveSubagentInSessionTree({
        sessions: [parent, child],
        statuses: { ses_child: { type: "retry" } },
        parentSessionID: "ses_parent",
      }),
    ).toBe(true)
  })

  test("returns false once every child session is idle", () => {
    expect(
      hasActiveSubagentInSessionTree({
        sessions: [parent, child],
        statuses: { ses_child: { type: "idle" } },
        parentSessionID: "ses_parent",
      }),
    ).toBe(false)
  })

  test("returns false when children have no recorded status", () => {
    expect(
      hasActiveSubagentInSessionTree({
        sessions: [parent, child],
        statuses: {},
        parentSessionID: "ses_parent",
      }),
    ).toBe(false)
    expect(hasActiveSubagentInSessionTree({ sessions: [parent, child], parentSessionID: "ses_parent" })).toBe(false)
  })

  test("ignores busy sessions outside the tree", () => {
    expect(
      hasActiveSubagentInSessionTree({
        sessions: [parent, child, other],
        statuses: { ses_other: { type: "busy" } },
        parentSessionID: "ses_parent",
      }),
    ).toBe(false)
  })

  test("does not count the parent session itself", () => {
    expect(
      hasActiveSubagentInSessionTree({
        sessions: [parent],
        statuses: { ses_parent: { type: "busy" } },
        parentSessionID: "ses_parent",
      }),
    ).toBe(false)
  })
})

describe("footerSubagentStatusView", () => {
  const now = 1_000_000
  const parent = { id: "ses_parent" }
  const childA = { id: "ses_child_a", parentID: "ses_parent" }
  const childB = { id: "ses_child_b", parentID: "ses_parent" }
  const other = { id: "ses_other" }

  test("returns undefined when no child session is active", () => {
    expect(
      footerSubagentStatusView({
        sessions: [parent, childA],
        statuses: { ses_child_a: { type: "idle" } },
        parentSessionID: "ses_parent",
        now,
      }),
    ).toBeUndefined()
    expect(
      footerSubagentStatusView({ sessions: [parent, childA], statuses: {}, parentSessionID: "ses_parent", now }),
    ).toBeUndefined()
  })

  test("ignores busy sessions outside the parent's tree", () => {
    expect(
      footerSubagentStatusView({
        sessions: [parent, childA, other],
        statuses: { ses_other: { type: "busy" } },
        parentSessionID: "ses_parent",
        now,
      }),
    ).toBeUndefined()
  })

  test("projects a single busy child into a working footer row", () => {
    const view = footerSubagentStatusView({
      sessions: [parent, childA],
      statuses: {
        ses_child_a: {
          type: "busy",
          waitState: "tool",
          activeTool: "bash",
          startedAt: now - 30_000,
          lastActivityAt: now - 5_000,
        },
      },
      parentSessionID: "ses_parent",
      now,
    })
    expect(view).toEqual({
      label: "Subagent: Running command · 30s",
      stale: false,
      tone: "working",
      running: 1,
    })
  })

  test("prefixes the active count when several children run", () => {
    const view = footerSubagentStatusView({
      sessions: [parent, childA, childB],
      statuses: {
        ses_child_a: {
          type: "busy",
          waitState: "llm",
          startedAt: now - 50_000,
          lastActivityAt: now - 20_000,
        },
        ses_child_b: {
          type: "busy",
          waitState: "tool",
          activeTool: "read",
          startedAt: now - 10_000,
          lastActivityAt: now - 1_000,
        },
      },
      parentSessionID: "ses_parent",
      now,
    })
    // The child with the freshest activity represents the group.
    expect(view?.label).toBe("2 subagents: Scanning files · 10s")
    expect(view?.running).toBe(2)
    expect(view?.tone).toBe("working")
  })

  test("surfaces the stale warning of the representative child", () => {
    const view = footerSubagentStatusView({
      sessions: [parent, childA],
      statuses: {
        ses_child_a: {
          type: "busy",
          waitState: "llm",
          startedAt: now - 120_000,
          lastActivityAt: now - 70_000,
        },
      },
      parentSessionID: "ses_parent",
      now,
    })
    expect(view?.stale).toBe(true)
    expect(view?.tone).toBe("warning")
    expect(view?.label).toBe("Subagent: Still waiting for model · 2m")
  })

  test("shows the retry countdown when the child is retrying", () => {
    const view = footerSubagentStatusView({
      sessions: [parent, childA],
      statuses: { ses_child_a: { type: "retry", attempt: 2, message: "boom", next: now + 5_000 } },
      parentSessionID: "ses_parent",
      now,
    })
    expect(view?.label).toBe("Subagent: Retrying in 5s")
    expect(view?.tone).toBe("warning")
  })

  test("prefers a busy child over a retrying one as the representative", () => {
    const view = footerSubagentStatusView({
      sessions: [parent, childA, childB],
      statuses: {
        ses_child_a: { type: "retry", attempt: 1, message: "boom", next: now + 5_000 },
        ses_child_b: {
          type: "busy",
          waitState: "llm",
          startedAt: now - 8_000,
          lastActivityAt: now - 2_000,
        },
      },
      parentSessionID: "ses_parent",
      now,
    })
    expect(view?.label).toBe("2 subagents: Thinking · 8s")
    expect(view?.running).toBe(2)
  })
})
