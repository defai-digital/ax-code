import type { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Log } from "../util/log"
import type { MessageV2 } from "./message-v2"
import { AutonomousContinuationPrompt } from "./prompt-autonomous-continuations"
import { completionGateRetryDecision } from "./prompt-autonomous-decisions"
import { publishPromptFailure } from "./prompt-loop-failure"
import type { SessionID } from "./schema"

const log = Log.create({ service: "session.prompt" })

type EmptySubagentCompletionGate = Extract<
  AutonomousCompletionGate.Decision,
  { status: "blocked"; reason: "empty_subagent_result" }
>

type PromptLoopCompletionGateRetryTransition =
  | {
      action: "continue"
      signature: string
      retries: number
      text: string
    }
  | {
      action: "stop"
      reason: "step_limit" | "stalled"
    }

type PromptLoopCompletionGateRetryDeps = {
  info?: (message: string, fields: Record<string, unknown>) => void
  warn?: (message: string, fields: Record<string, unknown>) => void
  publishFailure?: typeof publishPromptFailure
}

export async function handlePromptLoopCompletionGateRetry(
  input: {
    sessionID: SessionID
    assistant: MessageV2.Assistant
    gate: EmptySubagentCompletionGate
    previousSignature: string | undefined
    retries: number
    maxRetries: number
    isLastStep: boolean
  },
  deps: PromptLoopCompletionGateRetryDeps = {},
): Promise<PromptLoopCompletionGateRetryTransition> {
  const decision = completionGateRetryDecision({
    gate: input.gate,
    previousSignature: input.previousSignature,
    retries: input.retries,
    maxRetries: input.maxRetries,
    isLastStep: input.isLastStep,
  })

  if (decision.action === "stop") {
    ;(deps.warn ?? log.warn)("autonomous completion gate stopped session", {
      command: "session.prompt.loop",
      status: "stopped",
      errorCode: decision.errorCode,
      sessionID: input.sessionID,
      reason: input.gate.reason,
      message: input.gate.message,
      attempts: decision.attempts,
      maxAttempts: input.maxRetries,
    })
    await (deps.publishFailure ?? publishPromptFailure)({
      sessionID: input.sessionID,
      assistant: input.assistant,
      message: decision.message,
      // The completion gate blocked after retries; surface the stop reason
      // as visible text so the transcript ends with a clear explanation.
      surfaceAsText: true,
    })
    return { action: "stop", reason: decision.reason }
  }

  ;(deps.info ?? log.info)("autonomous completion gate continuation", {
    command: "session.prompt.loop",
    status: "ok",
    sessionID: input.sessionID,
    reason: input.gate.reason,
    message: input.gate.message,
    attempt: decision.attempt,
    maxAttempts: input.maxRetries,
  })
  return {
    action: "continue",
    signature: decision.signature,
    retries: decision.retries,
    text: AutonomousContinuationPrompt.completionGateRetry({
      message: input.gate.message,
      attempt: decision.attempt,
      maxAttempts: input.maxRetries,
    }),
  }
}
