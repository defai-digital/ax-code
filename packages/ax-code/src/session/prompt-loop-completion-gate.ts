import { AgentControlEvents } from "../control-plane/agent-control-events"
import type { AutonomousCompletionGate } from "../control-plane/autonomous-completion-gate"
import { Recorder } from "../replay/recorder"
import type { ReplayEvent } from "../replay/event"
import type { MessageID, SessionID } from "./schema"
import { completionGateEventState } from "./prompt-autonomous-decisions"

type PromptLoopCompletionGateDeps = {
  emit?: (event: ReplayEvent) => void
}

export function emitPromptLoopCompletionGateDecision(
  input: {
    sessionID: SessionID
    messageID: MessageID
    step: number
    modelFinished: boolean
    gate: AutonomousCompletionGate.Decision
    todoRetries: number
    maxTodoRetries: number
    completionGateRetries: number
    maxCompletionGateRetries: number
  },
  deps: PromptLoopCompletionGateDeps = {},
): boolean {
  const shouldEmit =
    input.modelFinished || (input.gate.status === "blocked" && input.gate.reason === "empty_subagent_result")
  if (!shouldEmit) return false

  const gateEventState = completionGateEventState({
    gate: input.gate,
    todoRetries: input.todoRetries,
    maxTodoRetries: input.maxTodoRetries,
    completionGateRetries: input.completionGateRetries,
    maxCompletionGateRetries: input.maxCompletionGateRetries,
  })
  ;(deps.emit ?? Recorder.emit)(
    AgentControlEvents.completionGateDecided({
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.step,
      status: input.gate.status,
      reason: gateEventState.reason,
      message: gateEventState.message,
      retryCount: gateEventState.retryCount,
      maxRetries: gateEventState.maxRetries,
    }),
  )
  return true
}
