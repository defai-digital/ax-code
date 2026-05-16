import { describe, expect, test } from "bun:test"

import { ReasoningPolicy } from "../../src/control-plane/reasoning-policy"

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

  test("classifies small requests as fast without provider options", () => {
    expect(
      ReasoningPolicy.decide({
        small: true,
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "summarize this" }],
      }),
    ).toMatchObject({
      depth: "fast",
      reason: "small_request",
      checkpoint: false,
      options: {},
    })
  })

  test("honors explicit fast requests even without reasoning-capable models", () => {
    expect(
      ReasoningPolicy.decide({
        requestedDepth: "fast",
        model: { capabilities: { reasoning: false }, options: {}, variants: {} },
        agent: buildAgent,
        messages: [{ role: "user", content: "summarize this quickly" }],
      }),
    ).toMatchObject({
      depth: "fast",
      reason: "explicit_request",
      options: {},
      checkpoint: false,
    })
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

  test("upgrades Traditional Chinese planning and risk signals", () => {
    expect(
      ReasoningPolicy.options({
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "請規劃複雜重構，並用最佳實務處理效能瓶頸" }],
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

  test("respects nested explicit provider reasoning options", () => {
    expect(
      ReasoningPolicy.options({
        model: baseModel,
        agent: planAgent,
        providerOptions: {
          google: {
            thinkingConfig: {
              thinkingLevel: "low",
            },
          },
        },
        messages: [{ role: "user", content: "plan a complex migration" }],
      }),
    ).toEqual({})
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

  test("uses max options for explicit xdeep requests when available", () => {
    expect(
      ReasoningPolicy.decide({
        requestedDepth: "xdeep",
        model: {
          capabilities: { reasoning: true },
          options: {},
          variants: {
            high: { reasoningEffort: "high" },
            max: { reasoningEffort: "max" },
          },
        },
        agent: buildAgent,
        messages: [{ role: "user", content: "plan the architecture" }],
      }),
    ).toMatchObject({
      depth: "xdeep",
      reason: "explicit_request",
      checkpoint: true,
      options: { reasoningEffort: "max" },
    })
  })

  test("falls back from xdeep to deep when max options are unavailable", () => {
    expect(
      ReasoningPolicy.decide({
        requestedDepth: "xdeep",
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "plan the architecture" }],
      }),
    ).toMatchObject({
      depth: "deep",
      reason: "explicit_request",
      checkpoint: true,
      options: { reasoningEffort: "high" },
    })
  })

  test("escalates repeated failures to deep reasoning", () => {
    expect(
      ReasoningPolicy.decide({
        failureCount: 2,
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "fix this" }],
      }),
    ).toMatchObject({
      depth: "deep",
      reason: "repeated_failure",
      checkpoint: true,
    })
  })

  test("ignores empty variants and falls back to usable medium options", () => {
    expect(
      ReasoningPolicy.options({
        model: {
          capabilities: { reasoning: true },
          options: {},
          variants: {
            high: { disabled: false },
            medium: { reasoningEffort: "medium" },
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

  test("extracts objective text from the latest user message", () => {
    expect(
      ReasoningPolicy.objective([
        { role: "user", content: "first task" },
        { role: "assistant", content: "answer" },
        { role: "user", content: [{ type: "text", text: " plan the v5 control plane " }] },
      ]),
    ).toBe("plan the v5 control plane")
  })

  test("escalates high uncertainty to deep reasoning", () => {
    expect(
      ReasoningPolicy.decide({
        uncertainty: "high",
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "fix this ambiguous issue" }],
      }),
    ).toMatchObject({
      depth: "deep",
      reason: "high_uncertainty",
      checkpoint: true,
    })
  })

  test("escalates high blast radius to deep reasoning", () => {
    expect(
      ReasoningPolicy.decide({
        blastRadius: "high",
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "refactor this module" }],
      }),
    ).toMatchObject({
      depth: "deep",
      reason: "high_blast_radius",
      checkpoint: true,
    })
  })

  test("does not escalate for failure count below threshold", () => {
    expect(
      ReasoningPolicy.decide({
        failureCount: 1,
        model: baseModel,
        agent: buildAgent,
        messages: [{ role: "user", content: "fix this" }],
      }),
    ).toMatchObject({
      depth: "standard",
      checkpoint: false,
    })
  })

  test("falls back to standard when model lacks reasoning capability even in autonomous mode", () => {
    expect(
      ReasoningPolicy.decide({
        autonomous: true,
        model: { capabilities: { reasoning: false }, options: {}, variants: {} },
        agent: buildAgent,
        messages: [{ role: "user", content: "do a complex task" }],
      }),
    ).toMatchObject({
      depth: "standard",
      checkpoint: false,
    })
  })

  test("honors explicit standard requestedDepth", () => {
    expect(
      ReasoningPolicy.decide({
        requestedDepth: "standard",
        model: baseModel,
        agent: planAgent,
        messages: [{ role: "user", content: "plan the architecture" }],
      }),
    ).toMatchObject({
      depth: "standard",
      reason: "explicit_request",
      checkpoint: false,
    })
  })

  test("systemReminder returns undefined for standard depth decisions", () => {
    expect(
      ReasoningPolicy.systemReminder({ depth: "standard", checkpoint: false, options: {} }),
    ).toBeUndefined()
  })

  test("systemReminder returns undefined for fast depth decisions", () => {
    expect(
      ReasoningPolicy.systemReminder({ depth: "fast", checkpoint: false, options: {} }),
    ).toBeUndefined()
  })

  test("systemReminder returns undefined for deep decisions that do not require checkpoint", () => {
    expect(
      ReasoningPolicy.systemReminder({ depth: "deep", checkpoint: false, options: { reasoningEffort: "high" } }),
    ).toBeUndefined()
  })

  test("objective returns empty string when no messages are present", () => {
    expect(ReasoningPolicy.objective([])).toBe("")
  })

  test("objective returns empty string when no user messages are present", () => {
    expect(
      ReasoningPolicy.objective([
        { role: "assistant", content: "Hello, how can I help?" },
        { role: "assistant", content: "Please provide your task." },
      ]),
    ).toBe("")
  })

  test("objective extracts content from a content-property object", () => {
    expect(
      ReasoningPolicy.objective([
        { role: "user", content: { content: "plan the migration" } },
      ]),
    ).toBe("plan the migration")
  })
})
