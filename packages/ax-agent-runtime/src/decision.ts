// Turn decision kernel DTOs for @ax-code/ax-agent-runtime.
//
// Phase 1 holds the decision shapes only. The decision functions stay in the
// ax-code core (session/prompt/prompt-loop-decisions.ts,
// session/prompt/prompt-loop-exit.ts); golden tables project their results
// into these DTOs. IDs are plain strings; closed sets mirror the core unions.
//
// Message-carrying fields (message, logMessage) are opaque carriers: the
// wording stays owned by core product copy; the DTO only preserves the value
// for golden comparison. from/to preserve the core provider/model key format
// opaquely for the same reason.

export namespace TurnDecision {
  // ─── Processor loop ───
  export type ProcessorAction = "continue" | "stop" | "compact"
  export type StopReason = "completed" | "error"
  export type CompactionTriggerReason = "provider_usage" | "context_overflow_error" | "request_too_large"

  export type ProcessorDecision =
    | { action: "continue" }
    | { action: "stop"; reason: StopReason; message?: string }
    | { action: "compact"; overflow: boolean; triggerReason: CompactionTriggerReason }

  // ─── Assistant exit ───
  export type AssistantExitDecision =
    | { action: "continue" }
    | { action: "complete" }
    | { action: "complete_unknown_finish"; logMessage: string }

  export type LoopExit = { action: "continue" } | { action: "stop"; reason: "completed" }

  // Plain-string mirror of the core turn cursor. No message store types here;
  // the core glue converts its branded records into this shape.
  // Ordering note: on timestamp ties the core falls back to a lexicographic
  // lastUserID < lastAssistant.id comparison, which relies on the core
  // monotonic ID encoding. Consumers must treat IDs as opaque strings and
  // preserve that comparison.
  export type TurnCursor = {
    lastUserID: string
    lastUserCreatedAt?: number
    lastAssistant?: { id: string; finish?: string; created?: number }
  }

  // ─── Compaction ───
  export type PendingCompaction =
    | { type: "break"; reason: StopReason }
    | { type: "retry"; delayMs: number }
    | { type: "continue" }

  export type CompactionBreakReason = "completed" | "error" | "aborted"

  // ─── Errors ───
  export type ConsecutiveErrorDecision = { action: "continue" } | { action: "stop"; reason: "error"; message: string }

  // ─── Provider fallback ───
  export type FallbackLookup =
    | { action: "skip" }
    | { action: "lookup"; errorMessage: string | undefined; stopWithoutFallback: boolean }

  export type FallbackSwitch = {
    from: string
    to: string
    reason: string
    message: string
    nextConsecutiveErrors: number
  }
}
