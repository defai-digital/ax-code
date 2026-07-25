import { describe, expect, test } from "vitest"
import { handlePromptLoopTotalStepLimit } from "../../src/session/prompt-loop-total-step-limit"
import { SessionID } from "../../src/session/schema"

describe("prompt loop total step limit", () => {
  test("ignores runs under the cumulative ceiling without side effects", async () => {
    const sideEffects: unknown[] = []

    const result = await handlePromptLoopTotalStepLimit(
      {
        sessionID: SessionID.descending(),
        totalSteps: 1999,
        totalStepLimit: 2000,
        continuations: 7,
        goal: { objective: "finish refactor", status: "active" },
      },
      {
        warn(message, fields) {
          sideEffects.push({ message, fields })
        },
        publishError(input) {
          sideEffects.push(input)
        },
        async pauseGoal() {
          sideEffects.push("paused")
        },
      },
    )

    expect(result).toEqual({ action: "ignore" })
    expect(sideEffects).toEqual([])
  })

  test("stops without touching the goal when no goal is set", async () => {
    const sessionID = SessionID.descending()
    const published: { message: string }[] = []
    let paused = 0

    const result = await handlePromptLoopTotalStepLimit(
      {
        sessionID,
        totalSteps: 2000,
        totalStepLimit: 2000,
        continuations: 3,
      },
      {
        warn() {},
        publishError(input) {
          published.push({ message: input.message })
        },
        async pauseGoal() {
          paused += 1
        },
      },
    )

    expect(result).toMatchObject({ action: "stop", reason: "step_limit" })
    if (result.action !== "stop") throw new Error("expected stop")
    expect(paused).toBe(0)
    expect(result.message).toContain("cumulative step ceiling")
    expect(result.message).not.toContain("/goal resume")
    expect(published).toHaveLength(1)
  })

  test("pauses an active goal at the ceiling and appends resume guidance", async () => {
    const sessionID = SessionID.descending()
    const pausedSessions: SessionID[] = []
    const published: { message: string }[] = []
    const warnings: { message: string; fields: Record<string, unknown> }[] = []

    const result = await handlePromptLoopTotalStepLimit(
      {
        sessionID,
        totalSteps: 20_000,
        totalStepLimit: 20_000,
        continuations: 120,
        goal: { objective: "keep main green", status: "active" },
      },
      {
        warn(message, fields) {
          warnings.push({ message, fields })
        },
        publishError(input) {
          published.push({ message: input.message })
        },
        async pauseGoal(id) {
          pausedSessions.push(id)
        },
      },
    )

    expect(result).toMatchObject({ action: "stop", reason: "step_limit" })
    if (result.action !== "stop") throw new Error("expected stop")
    expect(pausedSessions).toEqual([sessionID])
    expect(result.message).toContain('goal "keep main green" was paused')
    expect(result.message).toContain("/goal resume")
    expect(result.message).toContain("session.max_total_steps")
    // The published error carries the same goal-aware message the transcript gets.
    expect(published).toHaveLength(1)
    expect(published[0]?.message).toBe(result.message)
    expect(warnings.some((w) => w.message === "cumulative total step limit reached")).toBe(true)
    expect(warnings.find((w) => w.message === "cumulative total step limit reached")?.fields["goalPaused"]).toBe(true)
  })

  test("leaves paused and terminal goals untouched at the ceiling", async () => {
    let paused = 0

    const result = await handlePromptLoopTotalStepLimit(
      {
        sessionID: SessionID.descending(),
        totalSteps: 2000,
        totalStepLimit: 2000,
        continuations: 0,
        goal: { objective: "already parked", status: "paused" },
      },
      {
        warn() {},
        publishError() {},
        async pauseGoal() {
          paused += 1
        },
      },
    )

    expect(result).toMatchObject({ action: "stop" })
    if (result.action !== "stop") throw new Error("expected stop")
    expect(paused).toBe(0)
    expect(result.message).not.toContain("/goal resume")
  })

  test("still stops with actionable guidance when pausing the goal fails", async () => {
    const warnings: { message: string }[] = []

    const result = await handlePromptLoopTotalStepLimit(
      {
        sessionID: SessionID.descending(),
        totalSteps: 2000,
        totalStepLimit: 2000,
        continuations: 4,
        goal: { objective: "finish refactor", status: "active" },
      },
      {
        warn(message) {
          warnings.push({ message })
        },
        publishError() {},
        async pauseGoal() {
          throw new Error("db locked")
        },
      },
    )

    expect(result).toMatchObject({ action: "stop", reason: "step_limit" })
    if (result.action !== "stop") throw new Error("expected stop")
    expect(result.message).toContain("still active")
    expect(result.message).toContain("/goal pause")
    expect(warnings.some((w) => w.message === "failed to pause goal at cumulative step ceiling")).toBe(true)
  })
})
