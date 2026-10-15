import { describe, expect, test } from "vitest"
import {
  autonomousActiveView,
  autonomousProgressLabel,
  isAutonomousProducedMessage,
  isLiveAutonomousText,
} from "@/cli/tui/routes/session/autonomous-active"

describe("autonomousActiveView", () => {
  test("idle status is not active", () => {
    expect(autonomousActiveView({ type: "idle" })).toEqual({ active: false })
  })

  test("undefined status is not active", () => {
    expect(autonomousActiveView(undefined)).toEqual({ active: false })
  })

  test("retry status is not active", () => {
    expect(
      autonomousActiveView({ type: "retry", attempt: 1, message: "rate limited", next: Date.now() + 1000 }),
    ).toEqual({ active: false })
  })

  test("busy without step/maxSteps is not active (single-turn chat)", () => {
    expect(autonomousActiveView({ type: "busy", waitState: "llm" })).toEqual({ active: false })
    expect(autonomousActiveView({ type: "busy", step: 3 })).toEqual({ active: false })
    expect(autonomousActiveView({ type: "busy", maxSteps: 50 })).toEqual({ active: false })
  })

  test("busy with maxSteps=0 is not active (defensive against bad emit)", () => {
    expect(autonomousActiveView({ type: "busy", step: 0, maxSteps: 0 })).toEqual({ active: false })
  })

  test("busy with step + maxSteps is active and surfaces both", () => {
    expect(autonomousActiveView({ type: "busy", step: 5, maxSteps: 50 })).toEqual({
      active: true,
      step: 5,
      maxSteps: 50,
    })
  })

  test("surfaces explicit model-turn and continuation progress", () => {
    const view = autonomousActiveView({
      type: "busy",
      step: 5,
      maxSteps: 50,
      segmentModelTurns: 5,
      segmentModelTurnLimit: 50,
      totalModelTurns: 105,
      totalModelTurnLimit: 2000,
      continuations: 2,
      continuationLimit: 3,
    })

    expect(view).toMatchObject({
      active: true,
      segmentModelTurns: 5,
      segmentModelTurnLimit: 50,
      totalModelTurns: 105,
      totalModelTurnLimit: 2000,
      continuations: 2,
      continuationLimit: 3,
    })
    // Early in the run (5/50, 105/2000): neither limit is near, so only the
    // step and the non-zero continuation count show.
    expect(autonomousProgressLabel(view)).toBe("step 5 · continued 2 of 3")
  })

  test("shows the segment limit once the run nears it", () => {
    const view = autonomousActiveView({
      type: "busy",
      step: 42,
      maxSteps: 50,
      segmentModelTurns: 42,
      segmentModelTurnLimit: 50,
    })

    expect(autonomousProgressLabel(view)).toBe("step 42 of 50")
  })

  test("shows the total budget once it nears its limit", () => {
    const view = autonomousActiveView({
      type: "busy",
      step: 3,
      maxSteps: 50,
      segmentModelTurns: 3,
      segmentModelTurnLimit: 50,
      totalModelTurns: 1700,
      totalModelTurnLimit: 2000,
    })

    // 3/50 is well below the segment threshold, so only the total budget shows.
    expect(autonomousProgressLabel(view)).toBe("step 3 · total 1700 of 2000")
  })

  test("renders an unbounded continuation cap without a limit", () => {
    const view = autonomousActiveView({
      type: "busy",
      step: 1,
      maxSteps: 500,
      continuations: 7,
      continuationLimit: null,
    })

    expect(autonomousProgressLabel(view)).toBe("step 1 · continued 7")
  })

  test("omits a limit that is not yet approached", () => {
    const view = autonomousActiveView({ type: "busy", step: 1, maxSteps: 500 })
    expect(autonomousProgressLabel(view)).toBe("step 1")
  })
})

describe("isLiveAutonomousText", () => {
  test("not last → not live (older messages never get the live bg)", () => {
    expect(isLiveAutonomousText({ last: false, message: { finish: undefined }, autonomousActive: true })).toBe(false)
  })

  test("not autonomous active → not live (single-turn chat stays plain)", () => {
    expect(isLiveAutonomousText({ last: true, message: { finish: undefined }, autonomousActive: false })).toBe(false)
  })

  test("autonomous + last + still streaming → live", () => {
    expect(isLiveAutonomousText({ last: true, message: { finish: undefined }, autonomousActive: true })).toBe(true)
    // tool-calls is a continuation marker — the loop is still mid-flight
    expect(isLiveAutonomousText({ last: true, message: { finish: "tool-calls" }, autonomousActive: true })).toBe(true)
  })

  test("autonomous + last + settled (finish=stop) → not live", () => {
    expect(isLiveAutonomousText({ last: true, message: { finish: "stop" }, autonomousActive: true })).toBe(false)
  })
})

describe("isAutonomousProducedMessage", () => {
  test("no step-finish parts → not autonomous", () => {
    expect(isAutonomousProducedMessage([])).toBe(false)
    expect(isAutonomousProducedMessage([{ type: "text" }, { type: "tool" }])).toBe(false)
  })

  test("single step-finish (normal single-turn) → not autonomous", () => {
    expect(isAutonomousProducedMessage([{ type: "text" }, { type: "step-finish" }])).toBe(false)
  })

  test("two or more step-finish parts → autonomous", () => {
    expect(
      isAutonomousProducedMessage([
        { type: "text" },
        { type: "step-finish" },
        { type: "tool" },
        { type: "step-finish" },
      ]),
    ).toBe(true)
  })
})
