import { describe, expect, test } from "vitest"
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

  test("uses the latest verification observation in a step", () => {
    const result = AgentOptimizationTrace.verificationStatusFromObservations({
      repeatedFailureDetected: false,
      observations: [
        { tool: "bash", status: "error", input: { command: "bun test" } },
        { tool: "bash", status: "completed", input: { command: "bun test" } },
      ],
    })
    expect(result).toEqual({
      status: "pass",
      command: "bun test",
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
  test("decodeTraceEvent decodes valid trace objects", () => {
    const event = makeEvent()
    expect(AgentOptimizationTrace.decodeTraceEvent(event)).toEqual(event)
  })

  test("decodeTraceEvent returns null for invalid trace objects", () => {
    expect(AgentOptimizationTrace.decodeTraceEvent({ ...makeEvent(), routeClass: "fast" })).toBeNull()
    expect(
      AgentOptimizationTrace.decodeTraceEvent({
        ...makeEvent(),
        contextPackSummary: { totalTokens: 4000, tierCounts: [1, 2, 3], droppedTiers: [] },
      }),
    ).toBeNull()
  })

  test("round-trips a full event", () => {
    const event = makeEvent()
    const json = AgentOptimizationTrace.serialize(event)
    const parsed = AgentOptimizationTrace.deserialize(json)
    expect(parsed).toEqual(event)
    expect(AgentOptimizationTrace.deserialize(`  ${json}\n`)).toEqual(event)
  })

  test("deserialize returns null on invalid JSON", () => {
    expect(AgentOptimizationTrace.deserialize("{not valid}")).toBeNull()
    expect(AgentOptimizationTrace.deserialize("")).toBeNull()
  })

  test("deserialize returns null on invalid trace event shape", () => {
    expect(AgentOptimizationTrace.deserialize(JSON.stringify({ ...makeEvent(), routeClass: "fast" }))).toBeNull()
    expect(
      AgentOptimizationTrace.deserialize(
        JSON.stringify({
          ...makeEvent(),
          contextPackSummary: { totalTokens: 4000, tierCounts: [1, 2, 3], droppedTiers: [] },
        }),
      ),
    ).toBeNull()
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
