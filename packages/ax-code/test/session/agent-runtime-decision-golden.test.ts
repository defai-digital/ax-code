import { describe, expect, test } from "vitest"
import type { TurnDecision } from "@ax-code/ax-agent-runtime/decision"
import { AgentRuntimeGlue } from "@/agent-runtime-glue"
import type { MessageV2 } from "@/session/message-v2"
import type { MessageID, SessionID } from "@/session/schema"
import type { ModelID, ProviderID } from "@/provider/schema"
import {
  assistantLoopExitDecision,
  assistantRespondedAfterUser,
  compactionLoopBreakReason,
  consecutiveErrorDecision,
  consecutiveErrorStopMessage,
  isRetryableNetworkErrorMessage,
  pendingCompactionDecision,
  processorLoopDecision,
  providerFallbackLookupDecision,
  providerFallbackNotice,
  providerFallbackSwitchState,
  shouldScheduleUsageCompaction,
} from "@/session/prompt/prompt-loop-decisions"
import { resolvePromptLoopAssistantExit } from "@/session/prompt/prompt-loop-exit"

const SESSION = "session-1" as SessionID

function cursor(
  lastUserID: string,
  lastAssistant?: { id: string; finish: string; created?: number },
  lastUserCreatedAt?: number,
) {
  return {
    lastUserID,
    lastUserCreatedAt,
    lastAssistant:
      lastAssistant === undefined
        ? undefined
        : {
            id: lastAssistant.id as MessageID,
            finish: lastAssistant.finish,
            time: lastAssistant.created === undefined ? undefined : { created: lastAssistant.created },
          },
  }
}

describe("processorLoopDecision goldens", () => {
  const cases: Array<[string, Parameters<typeof processorLoopDecision>[0], TurnDecision.ProcessorDecision]> = [
    [
      "stop without error completes",
      { result: "stop", messageFinish: undefined, hasError: false },
      { action: "stop", reason: "completed" },
    ],
    ["stop with error", { result: "stop", messageFinish: "stop", hasError: true }, { action: "stop", reason: "error" }],
    [
      "first request-too-large compacts",
      { result: "compact_request_too_large", messageFinish: undefined, hasError: false },
      { action: "compact", overflow: true, triggerReason: "request_too_large" },
    ],
    [
      "repeated request-too-large stops",
      {
        result: "compact_request_too_large",
        messageFinish: undefined,
        hasError: false,
        priorRequestTooLargeCompactions: 1,
      },
      {
        action: "stop",
        reason: "error",
        message:
          "The provider still rejects the request body as too large after media stripping and compaction. " +
          "Reduce attachment count or size, reduce the provider tool surface, or switch providers.",
      },
    ],
    [
      "compact with finish is usage-triggered",
      { result: "compact", messageFinish: "stop", hasError: false },
      { action: "compact", overflow: false, triggerReason: "provider_usage" },
    ],
    [
      "compact without finish is overflow-triggered",
      { result: "compact", messageFinish: undefined, hasError: false },
      { action: "compact", overflow: true, triggerReason: "context_overflow_error" },
    ],
    [
      "repeated overflow stops",
      { result: "compact", messageFinish: undefined, hasError: false, priorContextOverflowCompactions: 1 },
      {
        action: "stop",
        reason: "error",
        message:
          "The request still exceeds the model context window after compaction. " +
          "This usually means the provider's fixed prompt/tool schema is too large for the selected local model. " +
          "Try a model with a larger context window or reduce the provider tool surface.",
      },
    ],
    [
      "other results continue",
      { result: "continue", messageFinish: undefined, hasError: false },
      { action: "continue" },
    ],
  ]
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(AgentRuntimeGlue.toProcessorDecision(processorLoopDecision(input))).toEqual(expected)
    })
  }
})

describe("assistant turn goldens", () => {
  test("responded detection prefers wall clock, falls back to IDs", () => {
    expect(assistantRespondedAfterUser(cursor("u"))).toBe(false)
    expect(assistantRespondedAfterUser(cursor("u", { id: "a", finish: "" }))).toBe(false)
    expect(assistantRespondedAfterUser(cursor("u", { id: "a", finish: "stop", created: 10 }, 5))).toBe(true)
    expect(assistantRespondedAfterUser(cursor("u", { id: "a", finish: "stop", created: 5 }, 10))).toBe(false)
    expect(assistantRespondedAfterUser(cursor("a", { id: "b", finish: "stop", created: 7 }, 7))).toBe(true)
    expect(assistantRespondedAfterUser(cursor("b", { id: "a", finish: "stop" }))).toBe(false)
  })

  const cases: Array<[string, Parameters<typeof assistantLoopExitDecision>[0], TurnDecision.AssistantExitDecision]> = [
    [
      "unanswered prompt continues",
      { ...cursor("b", { id: "a", finish: "stop" }), hasPendingSubtask: false },
      { action: "continue" },
    ],
    [
      "finished turn completes",
      { ...cursor("a", { id: "b", finish: "stop" }), hasPendingSubtask: false },
      { action: "complete" },
    ],
    [
      "finished turn completes even with pending subtask",
      { ...cursor("a", { id: "b", finish: "stop" }), hasPendingSubtask: true },
      { action: "complete" },
    ],
    [
      "unknown finish without work completes with log",
      { ...cursor("a", { id: "b", finish: "unknown" }), hasPendingSubtask: false },
      { action: "complete_unknown_finish", logMessage: "model returned unknown finish with no actionable output" },
    ],
    [
      "unknown finish with pending subtask continues",
      { ...cursor("a", { id: "b", finish: "unknown" }), hasPendingSubtask: true },
      { action: "continue" },
    ],
    [
      "unknown finish with autonomous work continues",
      { ...cursor("a", { id: "b", finish: "unknown" }), hasPendingSubtask: false, hasPendingAutonomousWork: true },
      { action: "continue" },
    ],
    [
      "tool-calls finish continues",
      { ...cursor("a", { id: "b", finish: "tool-calls" }), hasPendingSubtask: false },
      { action: "continue" },
    ],
    [
      "length finish continues",
      { ...cursor("a", { id: "b", finish: "length" }), hasPendingSubtask: false },
      { action: "continue" },
    ],
  ]
  for (const [name, input, expected] of cases) {
    test(name, () => {
      expect(AgentRuntimeGlue.toAssistantExitDecision(assistantLoopExitDecision(input))).toEqual(expected)
    })
  }
})

describe("resolvePromptLoopAssistantExit goldens", () => {
  test("backend restart continues", () => {
    const error = {
      name: "MessageAbortedError",
      data: { metadata: { reason: "backend_restart" } },
    } as unknown as MessageV2.Assistant["error"]
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit({
        sessionID: SESSION,
        ...cursor("a", { id: "b", finish: "stop" }),
        lastAssistant: { id: "b" as MessageID, finish: "stop", error },
        hasPendingSubtask: false,
      }),
    )
    expect(actual).toEqual({ action: "continue" })
  })

  test("complete exits and logs info", () => {
    const infos: string[] = []
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit(
        {
          sessionID: SESSION,
          ...cursor("a", { id: "b", finish: "stop" }),
          hasPendingSubtask: false,
        },
        { info: (message) => infos.push(message) },
      ),
    )
    expect(actual).toEqual({ action: "stop", reason: "completed" })
    expect(infos).toEqual(["exiting loop"])
  })

  test("pending steering extends a complete turn", () => {
    const infos: string[] = []
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit(
        {
          sessionID: SESSION,
          ...cursor("a", { id: "b", finish: "stop" }),
          hasPendingSubtask: false,
          hasPendingSteering: true,
        },
        { info: (message) => infos.push(message) },
      ),
    )
    expect(actual).toEqual({ action: "continue" })
    expect(infos).toEqual(["extending loop for pending steering"])
  })

  test("unknown finish exits and warns", () => {
    const warns: string[] = []
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit(
        {
          sessionID: SESSION,
          ...cursor("a", { id: "b", finish: "unknown" }),
          hasPendingSubtask: false,
        },
        { warn: (message) => warns.push(message) },
      ),
    )
    expect(actual).toEqual({ action: "stop", reason: "completed" })
    expect(warns).toEqual(["model returned unknown finish with no actionable output"])
  })

  test("unanswered prompt continues silently", () => {
    const infos: string[] = []
    const warns: string[] = []
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit(
        {
          sessionID: SESSION,
          ...cursor("b", { id: "a", finish: "stop" }),
          hasPendingSubtask: false,
        },
        { info: (message) => infos.push(message), warn: (message) => warns.push(message) },
      ),
    )
    expect(actual).toEqual({ action: "continue" })
    expect(infos).toEqual([])
    expect(warns).toEqual([])
  })

  test("non-restart abort errors fall through to the normal decision", () => {
    const error = {
      name: "MessageAbortedError",
      data: { metadata: { reason: "user_cancel" } },
    } as unknown as MessageV2.Assistant["error"]
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit({
        sessionID: SESSION,
        ...cursor("a", { id: "b", finish: "stop" }),
        lastAssistant: { id: "b" as MessageID, finish: "stop", error },
        hasPendingSubtask: false,
      }),
    )
    expect(actual).toEqual({ action: "stop", reason: "completed" })
  })

  test("pending steering extends an unknown-finish turn", () => {
    const infos: string[] = []
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit(
        {
          sessionID: SESSION,
          ...cursor("a", { id: "b", finish: "unknown" }),
          hasPendingSubtask: false,
          hasPendingSteering: true,
        },
        { info: (message) => infos.push(message) },
      ),
    )
    expect(actual).toEqual({ action: "continue" })
    expect(infos).toEqual(["extending loop for pending steering"])
  })

  test("pending steering does not log when the loop already continues", () => {
    const infos: string[] = []
    const actual = AgentRuntimeGlue.toLoopExit(
      resolvePromptLoopAssistantExit(
        {
          sessionID: SESSION,
          ...cursor("b", { id: "a", finish: "stop" }),
          hasPendingSubtask: false,
          hasPendingSteering: true,
        },
        { info: (message) => infos.push(message) },
      ),
    )
    expect(actual).toEqual({ action: "continue" })
    expect(infos).toEqual([])
  })
})

describe("compaction goldens", () => {
  test("stop breaks as error", () => {
    expect(AgentRuntimeGlue.toPendingCompaction(pendingCompactionDecision({ result: "stop" }))).toEqual({
      type: "break",
      reason: "error",
    })
  })

  test("busy retries with backoff until the limit", () => {
    expect(AgentRuntimeGlue.toPendingCompaction(pendingCompactionDecision({ result: "busy" }))).toEqual({
      type: "retry",
      delayMs: 250,
    })
    expect(
      AgentRuntimeGlue.toPendingCompaction(pendingCompactionDecision({ result: "busy", busyRetries: 39 })),
    ).toEqual({
      type: "retry",
      delayMs: 250,
    })
    expect(
      AgentRuntimeGlue.toPendingCompaction(pendingCompactionDecision({ result: "busy", busyRetries: 40 })),
    ).toEqual({
      type: "break",
      reason: "error",
    })
  })

  test("other results continue", () => {
    expect(
      AgentRuntimeGlue.toPendingCompaction(pendingCompactionDecision({ result: "continue", overflow: true })),
    ).toEqual({ type: "continue" })
  })

  test("break reason honors cancellation", () => {
    expect(
      AgentRuntimeGlue.toCompactionBreakReason(compactionLoopBreakReason({ decision: "completed", aborted: false })),
    ).toBe("completed")
    expect(
      AgentRuntimeGlue.toCompactionBreakReason(compactionLoopBreakReason({ decision: "error", aborted: false })),
    ).toBe("error")
    expect(
      AgentRuntimeGlue.toCompactionBreakReason(compactionLoopBreakReason({ decision: "completed", aborted: true })),
    ).toBe("aborted")
    expect(
      AgentRuntimeGlue.toCompactionBreakReason(compactionLoopBreakReason({ decision: "error", aborted: true })),
    ).toBe("aborted")
  })
})

describe("error goldens", () => {
  test("retryable network matcher", () => {
    expect(isRetryableNetworkErrorMessage(undefined)).toBe(false)
    expect(isRetryableNetworkErrorMessage("")).toBe(false)
    expect(isRetryableNetworkErrorMessage("boom")).toBe(false)
    expect(isRetryableNetworkErrorMessage("ENOTFOUND api.example")).toBe(true)
    expect(isRetryableNetworkErrorMessage("fetch failed")).toBe(true)
    expect(isRetryableNetworkErrorMessage("SOCKET HANG UP")).toBe(true)
  })

  test("stop message variants", () => {
    const base = "Agent encountered 3 consecutive errors at step 5. Stopping to prevent retry loop."
    expect(consecutiveErrorStopMessage({ consecutiveErrors: 3, step: 5 })).toBe(
      `${base} Try rephrasing your request or breaking it into smaller tasks.`,
    )
    expect(consecutiveErrorStopMessage({ consecutiveErrors: 3, step: 5, errorMessage: "socket hang up" })).toBe(
      `${base} This looks like a retryable provider DNS/network failure (socket hang up). ` +
        `Recovery: check connectivity, switch provider, or retry when the provider is reachable.`,
    )
    expect(consecutiveErrorStopMessage({ consecutiveErrors: 3, step: 5, pendingTodoCount: 2 })).toBe(
      `${base} 2 unfinished todo(s) remain — resume after addressing the error, ` +
        `or switch provider. Try rephrasing your request or breaking it into smaller tasks.`,
    )
    expect(
      consecutiveErrorStopMessage({
        consecutiveErrors: 3,
        step: 5,
        errorMessage: "ENOTFOUND api.x",
        pendingTodoCount: 1,
      }),
    ).toBe(
      `${base} This looks like a retryable provider DNS/network failure (ENOTFOUND api.x) while 1 unfinished todo(s) remain. ` +
        `The autonomous run is paused as recoverable: unfinished todos are preserved. ` +
        `Recovery: fix network/DNS or switch provider, then resume the session (or re-send to continue from the remaining todos). ` +
        `Do not treat the task itself as failed.`,
    )
  })

  test("below the limit continues, at the limit stops", () => {
    expect(
      AgentRuntimeGlue.toConsecutiveErrorDecision(
        consecutiveErrorDecision({ consecutiveErrors: 2, maxConsecutiveErrors: 3, step: 5 }),
      ),
    ).toEqual({ action: "continue" })
    const stopped = AgentRuntimeGlue.toConsecutiveErrorDecision(
      consecutiveErrorDecision({ consecutiveErrors: 3, maxConsecutiveErrors: 3, step: 5 }),
    )
    expect(stopped.action).toBe("stop")
    if (stopped.action === "stop") {
      expect(stopped.reason).toBe("error")
      expect(stopped.message).toContain("Agent encountered 3 consecutive errors at step 5.")
    }
  })
})

describe("provider fallback goldens", () => {
  const current = { providerID: "anthropic" as ProviderID, modelID: "m1" as ModelID }
  const fallback = { providerID: "openai" as ProviderID, modelID: "m2" as ModelID }

  test("lookup triggers only for API errors with status and repetition", () => {
    expect(
      AgentRuntimeGlue.toFallbackLookup(providerFallbackLookupDecision({ consecutiveErrors: 9, error: null })),
    ).toEqual({
      action: "skip",
    })
    expect(
      AgentRuntimeGlue.toFallbackLookup(providerFallbackLookupDecision({ consecutiveErrors: 9, error: "boom" })),
    ).toEqual({ action: "skip" })
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 9,
          error: { name: "Error", statusCode: 429, message: "slow" },
        }),
      ),
    ).toEqual({ action: "skip" })
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 9,
          error: { name: "APIError", statusCode: 500, message: "broken" },
        }),
      ),
    ).toEqual({ action: "lookup", errorMessage: "broken", stopWithoutFallback: true })
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 1,
          error: { name: "APIError", statusCode: 429, message: "slow" },
        }),
      ),
    ).toEqual({ action: "skip" })
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 2,
          error: { name: "APIError", statusCode: 429, message: "slow" },
        }),
      ),
    ).toEqual({ action: "lookup", errorMessage: "slow", stopWithoutFallback: true })
  })

  test("auth failures stop without waiting for repetition", () => {
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 0,
          error: { name: "APIError", statusCode: 401, message: "nope" },
        }),
      ),
    ).toEqual({ action: "skip" })
  })

  test("nested status and quota messages resolve", () => {
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 2,
          error: { name: "APIError", data: { statusCode: 429, message: "nested" } },
        }),
      ),
    ).toEqual({ action: "lookup", errorMessage: "nested", stopWithoutFallback: true })
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 2,
          error: { name: "APIError", statusCode: 429, message: "quota exceeded" },
        }),
      ),
    ).toEqual({ action: "skip" })
  })

  test("responseBody JSON messages resolve", () => {
    expect(
      AgentRuntimeGlue.toFallbackLookup(
        providerFallbackLookupDecision({
          consecutiveErrors: 2,
          error: { name: "APIError", statusCode: 429, responseBody: `{"message":"rb"}` },
        }),
      ),
    ).toEqual({ action: "lookup", errorMessage: "rb", stopWithoutFallback: true })
  })

  test("switch state halves errors and formats the notice", () => {
    expect(
      AgentRuntimeGlue.toFallbackSwitch(
        providerFallbackSwitchState({ current, fallback, errorMessage: "boom", consecutiveErrors: 5 }),
      ),
    ).toEqual({
      from: "anthropic/m1",
      to: "openai/m2",
      reason: "boom",
      message: "Provider anthropic failed: boom. Switching to openai/m2.",
      nextConsecutiveErrors: 2,
    })
    expect(
      AgentRuntimeGlue.toFallbackSwitch(
        providerFallbackSwitchState({ current, fallback, errorMessage: "boom!", consecutiveErrors: 0 }),
      ),
    ).toEqual({
      from: "anthropic/m1",
      to: "openai/m2",
      reason: "boom!",
      message: "Provider anthropic failed: boom! Switching to openai/m2.",
      nextConsecutiveErrors: 0,
    })
    expect(providerFallbackNotice({ origin: "anthropic" as ProviderID, serving: fallback })).toBe(
      "Note: Using openai/m2 (anthropic unavailable)",
    )
  })

  test("non-positive error counts reset to zero", () => {
    for (const consecutiveErrors of [-3, Number.NaN]) {
      const switched = AgentRuntimeGlue.toFallbackSwitch(
        providerFallbackSwitchState({ current, fallback, errorMessage: undefined, consecutiveErrors }),
      )
      expect(switched.nextConsecutiveErrors).toBe(0)
      expect(switched.reason).toBe("unknown error")
    }
  })
})

describe("turn cursor projection goldens", () => {
  test("converts branded records to plain strings", () => {
    expect(
      AgentRuntimeGlue.toTurnCursor({
        lastUserID: "u",
        lastAssistant: { id: "a" as MessageID, finish: "stop", time: { created: 8 } },
      }),
    ).toEqual({
      lastUserID: "u",
      lastUserCreatedAt: undefined,
      lastAssistant: { id: "a", finish: "stop", created: 8 },
    })
  })

  test("absent assistant stays absent", () => {
    expect(AgentRuntimeGlue.toTurnCursor({ lastUserID: "u" })).toEqual({
      lastUserID: "u",
      lastUserCreatedAt: undefined,
      lastAssistant: undefined,
    })
  })
})

describe("usage compaction scheduling goldens", () => {
  // Raw booleans, no DTO: the input carries store types and a boolean needs
  // no projection. Same treatment as isRetryableNetworkErrorMessage.
  type LastFinished = NonNullable<Parameters<typeof shouldScheduleUsageCompaction>[0]["lastFinished"]>
  const finished = (summary: boolean): LastFinished => ({ summary }) as unknown as LastFinished

  test("schedules only for unfinished overflows", () => {
    expect(shouldScheduleUsageCompaction({ overflow: true })).toBe(false)
    expect(shouldScheduleUsageCompaction({ overflow: true, lastFinished: finished(false) })).toBe(true)
    expect(shouldScheduleUsageCompaction({ overflow: true, lastFinished: finished(true) })).toBe(false)
    expect(shouldScheduleUsageCompaction({ overflow: false, lastFinished: finished(false) })).toBe(false)
  })
})
