import { describe, expect, test } from "bun:test"
import {
  footerGoalChip,
  footerSessionStatusOrIdle,
  footerTokenChip,
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
