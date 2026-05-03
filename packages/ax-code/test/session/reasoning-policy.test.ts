import { describe, expect, test } from "bun:test"

import { ReasoningPolicy } from "../../src/session/reasoning-policy"

const baseModel = {
  capabilities: { reasoning: true },
  options: {},
  variants: {
    medium: { reasoningEffort: "medium" },
    high: { reasoningEffort: "high" },
  },
}

const buildAgent = { name: "build", options: {} }
const planAgent = { name: "plan", options: {} }

describe("ReasoningPolicy", () => {
  test("uses high reasoning for plan mode", () => {
    const decision = ReasoningPolicy.decide({
        model: baseModel,
        agent: planAgent,
        messages: [{ role: "user", content: "review the architecture" }],
      })

    expect(decision).toMatchObject({
      depth: "deep",
      reason: "plan_mode",
      checkpoint: true,
      options: { reasoningEffort: "high" },
    })
  })

  test("uses high reasoning for autonomous mode", () => {
    expect(
      ReasoningPolicy.options({
        autonomous: true,
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "fix this bug" }],
      }),
    ).toEqual({ reasoningEffort: "high" })
  })

  test("does not upgrade simple build tasks", () => {
    expect(
      ReasoningPolicy.options({
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "rename this variable" }],
      }),
    ).toEqual({})
  })

  test("upgrades when planning and risk signals are both present", () => {
    expect(
      ReasoningPolicy.options({
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "plan a complex migration with performance risk" }],
      }),
    ).toEqual({ reasoningEffort: "high" })
  })

  test("respects explicit user variants", () => {
    expect(
      ReasoningPolicy.options({
        userVariant: "low",
        model: baseModel,
        agent: planAgent,
        messages: [{ role: "user", content: "plan a complex migration" }],
      }),
    ).toEqual({})
  })

  test("respects explicit agent reasoning options", () => {
    const decision = ReasoningPolicy.decide({
        model: baseModel,
        agent: { name: "plan", options: { reasoningEffort: "low" } },
        messages: [{ role: "user", content: "plan a complex migration" }],
      })

    expect(decision).toMatchObject({
      depth: "standard",
      checkpoint: false,
      options: {},
    })
  })

  test("falls back to medium when high is disabled", () => {
    expect(
      ReasoningPolicy.options({
        model: {
          capabilities: { reasoning: true },
          options: {},
          variants: {
            medium: { reasoningEffort: "medium" },
            high: { reasoningEffort: "high", disabled: true },
          },
        },
        agent: planAgent,
        messages: [{ role: "user", content: "plan a complex migration" }],
      }),
    ).toEqual({ reasoningEffort: "medium" })
  })

  test("creates a checkpoint reminder for deep reasoning decisions", () => {
    const reminder = ReasoningPolicy.systemReminder({
      depth: "deep",
      reason: "planning_risk_signal",
      checkpoint: true,
      options: { reasoningEffort: "high" },
    })

    expect(reminder).toContain('depth="deep"')
    expect(reminder).toContain('reason="planning_risk_signal"')
    expect(reminder).toContain("Do not expose private chain-of-thought")
  })
})
