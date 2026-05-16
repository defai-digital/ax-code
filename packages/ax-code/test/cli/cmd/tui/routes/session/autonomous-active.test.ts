import { describe, expect, test } from "bun:test"
import { autonomousActiveView } from "@/cli/cmd/tui/routes/session/autonomous-active"

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
