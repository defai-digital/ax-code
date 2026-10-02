import { describe, expect, test } from "vitest"
import type { TurnDecision } from "../src/decision"
import { configureAgentRuntimeHost, getAgentRuntimeHost, type AgentRuntimeHost } from "../src/host"

describe("turn decision DTOs", () => {
  test("processor decision closed set", () => {
    const decisions: TurnDecision.ProcessorDecision[] = [
      { action: "continue" },
      { action: "stop", reason: "completed" },
      { action: "stop", reason: "error", message: "boom" },
      { action: "compact", overflow: true, triggerReason: "provider_usage" },
      { action: "compact", overflow: false, triggerReason: "context_overflow_error" },
      { action: "compact", overflow: true, triggerReason: "request_too_large" },
    ]
    expect(decisions).toHaveLength(6)
  })

  test("assistant exit and loop exit shapes", () => {
    const exit: TurnDecision.AssistantExitDecision = { action: "complete_unknown_finish", logMessage: "x" }
    const loop: TurnDecision.LoopExit = { action: "stop", reason: "completed" }
    expect(exit.action).toBe("complete_unknown_finish")
    expect(loop.reason).toBe("completed")
  })

  test("cursor uses plain strings", () => {
    const cursor: TurnDecision.TurnCursor = {
      lastUserID: "u1",
      lastUserCreatedAt: 7,
      lastAssistant: { id: "a1", finish: "stop", created: 8 },
    }
    expect(cursor.lastAssistant?.finish).toBe("stop")
  })

  test("compaction, error, and fallback shapes", () => {
    const pending: TurnDecision.PendingCompaction[] = [
      { type: "break", reason: "error" },
      { type: "retry", delayMs: 250 },
      { type: "continue" },
    ]
    const breakReason: TurnDecision.CompactionBreakReason = "aborted"
    const err: TurnDecision.ConsecutiveErrorDecision = { action: "stop", reason: "error", message: "m" }
    const lookup: TurnDecision.FallbackLookup = { action: "lookup", errorMessage: undefined, stopWithoutFallback: true }
    const sw: TurnDecision.FallbackSwitch = { from: "a", to: "b", reason: "r", message: "m", nextConsecutiveErrors: 1 }
    expect(pending).toHaveLength(3)
    expect([breakReason, err.action, lookup.action, sw.to]).toEqual(["aborted", "stop", "lookup", "b"])
  })
})

describe("host port", () => {
  test("throws before configure", () => {
    expect(() => getAgentRuntimeHost()).toThrow("not configured")
  })

  test("configure then get round-trips", () => {
    const host: AgentRuntimeHost = { now: () => 42, log: () => {} }
    configureAgentRuntimeHost(host)
    expect(getAgentRuntimeHost().now()).toBe(42)
  })
})
