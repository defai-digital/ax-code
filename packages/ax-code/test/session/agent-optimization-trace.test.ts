import { describe, expect, test } from "bun:test"
import { AgentOptimizationTrace } from "@/session/agent-optimization-trace"
import { ReplayEvent } from "@/replay/event"

function makeEvent(overrides: Partial<AgentOptimizationTrace.TraceEvent> = {}): AgentOptimizationTrace.TraceEvent {
  return {
    sessionID: "sess-1",
    eventID: "evt-1",
    timestamp: "2026-05-23T00:00:00.000Z",
    routeClass: "premium",
    providerID: "alibaba-coding-plan",
    modelID: "qwen3.7-max",
    contextPackSummary: { totalTokens: 4000, tierCounts: [2, 3, 1, 0], droppedTiers: [] },
    toolCallCount: 12,
    repeatedFailureCount: 0,
    repeatedFailureSignal: false,
    verificationStatus: "pass",
    patchOutcome: "accepted",
    cacheReadTokens: 800,
    cacheWriteTokens: 200,
    inputTokens: 5000,
    outputTokens: 1200,
    ...overrides,
  }
}

describe("AgentOptimizationTrace.detectRepeatedFailure", () => {
  test("returns not-detected when all surfaces unique", () => {
    const result = AgentOptimizationTrace.detectRepeatedFailure(["a", "b", "c"])
    expect(result.detected).toBe(false)
  })

  test("detects a surface repeated >= threshold times", () => {
    const result = AgentOptimizationTrace.detectRepeatedFailure(["src/foo.ts", "src/foo.ts", "src/foo.ts"])
    expect(result.detected).toBe(true)
    expect(result.surface).toBe("src/foo.ts")
    expect(result.count).toBe(3)
  })

  test("does not detect below threshold", () => {
    const result = AgentOptimizationTrace.detectRepeatedFailure(["a", "a"], 3)
    expect(result.detected).toBe(false)
  })

  test("custom threshold of 2 triggers on second occurrence", () => {
    const result = AgentOptimizationTrace.detectRepeatedFailure(["a", "b", "a"], 2)
    expect(result.detected).toBe(true)
    expect(result.surface).toBe("a")
    expect(result.count).toBe(2)
  })

  test("returns empty array safely", () => {
    const result = AgentOptimizationTrace.detectRepeatedFailure([])
    expect(result.detected).toBe(false)
  })
})

describe("AgentOptimizationTrace.contextPackSummary", () => {
  test("builds summary from params", () => {
    const s = AgentOptimizationTrace.contextPackSummary(3000, [2, 4, 1, 0], [3])
    expect(s.totalTokens).toBe(3000)
    expect(s.tierCounts).toEqual([2, 4, 1, 0])
    expect(s.droppedTiers).toEqual([3])
  })
})

describe("AgentOptimizationTrace.verificationStatusFromObservations", () => {
  test("marks successful verification commands as pass", () => {
    const result = AgentOptimizationTrace.verificationStatusFromObservations({
      repeatedFailureDetected: false,
      observations: [{ tool: "bash", status: "completed", input: { command: "bun test test/session/llm.test.ts" } }],
    })
    expect(result).toEqual({
      status: "pass",
      command: "bun test test/session/llm.test.ts",
    })
  })

  test("marks failed verification commands as fail", () => {
    const result = AgentOptimizationTrace.verificationStatusFromObservations({
      repeatedFailureDetected: false,
      observations: [{ tool: "verify_project", status: "error", input: {} }],
    })
    expect(result).toEqual({
      status: "fail",
      command: "verify_project",
    })
  })

  test("keeps non-verification tools as skip", () => {
    const result = AgentOptimizationTrace.verificationStatusFromObservations({
      repeatedFailureDetected: false,
      observations: [{ tool: "read", status: "completed", input: { path: "src/foo.ts" } }],
    })
    expect(result.status).toBe("skip")
  })
})

describe("AgentOptimizationTrace.serialize / deserialize", () => {
  test("round-trips a full event", () => {
    const event = makeEvent()
    const json = AgentOptimizationTrace.serialize(event)
    const parsed = AgentOptimizationTrace.deserialize(json)
    expect(parsed).toEqual(event)
  })

  test("deserialize returns null on invalid JSON", () => {
    expect(AgentOptimizationTrace.deserialize("{not valid}")).toBeNull()
  })

  test("serialize produces valid JSON string", () => {
    const json = AgentOptimizationTrace.serialize(makeEvent())
    expect(() => JSON.parse(json)).not.toThrow()
  })

  test("serialized output does not include raw prompt text (only summaries)", () => {
    const event = makeEvent({ toolCallCount: 42 })
    const json = AgentOptimizationTrace.serialize(event)
    // Just a safeguard: no field named 'content' or 'text' at top level
    const parsed = JSON.parse(json)
    expect(parsed).not.toHaveProperty("content")
    expect(parsed).not.toHaveProperty("promptText")
  })
})

describe("AgentOptimizationTrace replay event", () => {
  test("accepts serialized-safe trace fields in the replay schema", () => {
    const event = makeEvent()
    const parsed = ReplayEvent.parse({
      type: "agent.optimization.trace",
      stepIndex: 2,
      ...event,
    }) as Extract<ReplayEvent, { type: "agent.optimization.trace" }>
    expect(parsed.type).toBe("agent.optimization.trace")
    expect(parsed.contextPackSummary.totalTokens).toBe(4000)
    expect(parsed.verificationStatus).toBe("pass")
  })
})

describe("AgentOptimizationTrace.estimateCostUsd", () => {
  // Qwen3.7-Max via OpenRouter pricing: $2.50 input / $7.50 output per 1M tokens
  const inputPrice = 2.5
  const outputPrice = 7.5

  test("basic cost calculation", () => {
    const cost = AgentOptimizationTrace.estimateCostUsd({
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
    })
    expect(cost).toBeCloseTo(10.0, 5)
  })

  test("cache reads billed at 0.1x input price", () => {
    const cost = AgentOptimizationTrace.estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
    })
    // 0.1 * 2.5 = 0.25
    expect(cost).toBeCloseTo(0.25, 5)
  })

  test("cache writes billed at 1.25x input price", () => {
    const cost = AgentOptimizationTrace.estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
    })
    // 1.25 * 2.5 = 3.125
    expect(cost).toBeCloseTo(3.125, 5)
  })

  test("zero tokens yields zero cost", () => {
    const cost = AgentOptimizationTrace.estimateCostUsd({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
    })
    expect(cost).toBe(0)
  })

  test("realistic session estimate stays within expected range", () => {
    // 5k input, 1.2k output, 800 cache-read, 200 cache-write
    const cost = AgentOptimizationTrace.estimateCostUsd({
      inputTokens: 5000,
      outputTokens: 1200,
      cacheReadTokens: 800,
      cacheWriteTokens: 200,
      inputPricePerMillion: inputPrice,
      outputPricePerMillion: outputPrice,
    })
    expect(cost).toBeGreaterThan(0)
    expect(cost).toBeLessThan(0.1)
  })
})
