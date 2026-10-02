// Core glue for @ax-code/ax-agent-runtime (ADR-163).
//
// Phase 1: test-only projection of the core turn decision results into the
// incubation DTOs. Golden tables assert the projection; no production path
// imports this module.

import type { TurnDecision } from "@ax-code/ax-agent-runtime/decision"
import type { MessageV2 } from "./session/message-v2"
import type {
  assistantLoopExitDecision,
  compactionLoopBreakReason,
  consecutiveErrorDecision,
  pendingCompactionDecision,
  processorLoopDecision,
  providerFallbackLookupDecision,
  providerFallbackSwitchState,
} from "./session/prompt/prompt-loop-decisions"
import type { resolvePromptLoopAssistantExit } from "./session/prompt/prompt-loop-exit"

type AssertEqual<T, U> =
  (<G>() => G extends T ? 1 : 2) extends <G>() => G extends U ? 1 : 2
    ? (<G>() => G extends U ? 1 : 2) extends <G>() => G extends T ? 1 : 2
      ? true
      : never
    : never

export namespace AgentRuntimeGlue {
  export function toProcessorDecision(
    decision: ReturnType<typeof processorLoopDecision>,
  ): TurnDecision.ProcessorDecision {
    return decision
  }

  export function toAssistantExitDecision(
    decision: ReturnType<typeof assistantLoopExitDecision>,
  ): TurnDecision.AssistantExitDecision {
    return decision
  }

  export function toLoopExit(decision: ReturnType<typeof resolvePromptLoopAssistantExit>): TurnDecision.LoopExit {
    return decision
  }

  export function toPendingCompaction(
    decision: ReturnType<typeof pendingCompactionDecision>,
  ): TurnDecision.PendingCompaction {
    return decision
  }

  export function toCompactionBreakReason(
    decision: ReturnType<typeof compactionLoopBreakReason>,
  ): TurnDecision.CompactionBreakReason {
    return decision
  }

  export function toConsecutiveErrorDecision(
    decision: ReturnType<typeof consecutiveErrorDecision>,
  ): TurnDecision.ConsecutiveErrorDecision {
    return decision
  }

  export function toFallbackLookup(
    decision: ReturnType<typeof providerFallbackLookupDecision>,
  ): TurnDecision.FallbackLookup {
    return decision
  }

  export function toFallbackSwitch(
    decision: ReturnType<typeof providerFallbackSwitchState>,
  ): TurnDecision.FallbackSwitch {
    return decision
  }

  export type CoreTurnCursorInput = {
    lastUserID: string
    lastUserCreatedAt?: number
    lastAssistant?: Pick<MessageV2.Assistant, "id" | "finish"> & {
      time?: Pick<MessageV2.Assistant["time"], "created">
    }
  }

  export function toTurnCursor(input: CoreTurnCursorInput): TurnDecision.TurnCursor {
    return {
      lastUserID: input.lastUserID,
      lastUserCreatedAt: input.lastUserCreatedAt,
      lastAssistant:
        input.lastAssistant === undefined
          ? undefined
          : {
              id: String(input.lastAssistant.id),
              finish: input.lastAssistant.finish,
              created: input.lastAssistant.time?.created,
            },
    }
  }
}

// Bidirectional shape locks: if the core union narrows or the DTO drifts,
// these fail at compile time instead of silently widening the projection.
const _assertProcessor: AssertEqual<ReturnType<typeof processorLoopDecision>, TurnDecision.ProcessorDecision> = true
const _assertAssistantExit: AssertEqual<
  ReturnType<typeof assistantLoopExitDecision>,
  TurnDecision.AssistantExitDecision
> = true
const _assertLoopExit: AssertEqual<ReturnType<typeof resolvePromptLoopAssistantExit>, TurnDecision.LoopExit> = true
const _assertPendingCompaction: AssertEqual<
  ReturnType<typeof pendingCompactionDecision>,
  TurnDecision.PendingCompaction
> = true
const _assertCompactionBreak: AssertEqual<
  ReturnType<typeof compactionLoopBreakReason>,
  TurnDecision.CompactionBreakReason
> = true
const _assertConsecutiveError: AssertEqual<
  ReturnType<typeof consecutiveErrorDecision>,
  TurnDecision.ConsecutiveErrorDecision
> = true
const _assertFallbackLookup: AssertEqual<
  ReturnType<typeof providerFallbackLookupDecision>,
  TurnDecision.FallbackLookup
> = true
const _assertFallbackSwitch: AssertEqual<
  ReturnType<typeof providerFallbackSwitchState>,
  TurnDecision.FallbackSwitch
> = true

void [
  _assertProcessor,
  _assertAssistantExit,
  _assertLoopExit,
  _assertPendingCompaction,
  _assertCompactionBreak,
  _assertConsecutiveError,
  _assertFallbackLookup,
  _assertFallbackSwitch,
]
