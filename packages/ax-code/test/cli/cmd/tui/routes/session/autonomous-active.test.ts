import { describe, expect, test } from "bun:test"
import {
  autonomousActiveView,
  isAutonomousProducedMessage,
  isLiveAutonomousText,
} from "@/cli/cmd/tui/routes/session/autonomous-active"

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
