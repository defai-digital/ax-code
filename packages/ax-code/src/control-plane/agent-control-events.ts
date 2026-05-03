import type { ReplayEvent } from "@/replay/event"

import { AgentControl } from "./agent-control"
import { SafetyPolicy } from "./safety-policy"

export namespace AgentControlEvents {
  type BaseInput = {
    sessionID: string
    messageID?: string
    stepIndex?: number
    deterministic?: boolean
  }

  export function phaseChanged(
    input: BaseInput & {
      previousPhase?: AgentControl.Phase
      phase: AgentControl.Phase
      reason: string
    },
  ): ReplayEvent {
    return compact({
      type: "agent.phase.changed",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      previousPhase: input.previousPhase,
      phase: input.phase,
      reason: input.reason,
    })
  }

  export function reasoningSelected(
    input: BaseInput & {
      depth: AgentControl.ReasoningDepth
      reason: string
      policyVersion?: string
      checkpoint?: boolean
    },
  ): ReplayEvent {
    return compact({
      type: "agent.reasoning.selected",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      depth: input.depth,
      reason: input.reason,
      policyVersion: input.policyVersion,
      checkpoint: input.checkpoint,
    })
  }

  export function planCreated(
    input: BaseInput & {
      plan: AgentControl.PlanArtifact
    },
  ): ReplayEvent {
    return compact({
      type: "agent.plan.created",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      plan: input.plan,
    })
  }

  export function planUpdated(
    input: BaseInput & {
      plan: AgentControl.PlanArtifact
      reason?: string
    },
  ): ReplayEvent {
    return compact({
      type: "agent.plan.updated",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      plan: input.plan,
      reason: input.reason,
    })
  }

  export function validationUpdated(
    input: BaseInput & {
      status: AgentControl.ValidationStatus
      reason?: string
    },
  ): ReplayEvent {
    return compact({
      type: "agent.validation.updated",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      status: input.status,
      reason: input.reason,
    })
  }

  export function blocked(
    input: BaseInput & {
      phase: AgentControl.Phase
      reason: string
      recoverable: boolean
    },
  ): ReplayEvent {
    return compact({
      type: "agent.blocked",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      phase: input.phase,
      reason: input.reason,
      recoverable: input.recoverable,
    })
  }

  export function completionGateDecided(
    input: BaseInput & {
      status: "allow" | "blocked"
      reason?: "none" | "empty_subagent_result" | "unfinished_todos"
      message?: string
      retryCount?: number
      maxRetries?: number
    },
  ): ReplayEvent {
    return compact({
      type: "agent.completion_gate.decided",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      status: input.status,
      reason: input.reason,
      message: input.message,
      retryCount: input.retryCount,
      maxRetries: input.maxRetries,
    })
  }

  export function completed(
    input: BaseInput & {
      validationStatus: Extract<AgentControl.ValidationStatus, "not_required" | "passed">
      summary?: string
    },
  ): ReplayEvent {
    return compact({
      type: "agent.completed",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      phase: "complete",
      validationStatus: input.validationStatus,
      summary: input.summary,
    })
  }

  export function safetyDecided(
    input: BaseInput &
      SafetyPolicy.Decision & {
        permission: string
        tool?: string
        path?: string
        shadow?: boolean
      },
  ): ReplayEvent {
    return compact({
      type: "agent.safety.decided",
      sessionID: input.sessionID,
      messageID: input.messageID,
      stepIndex: input.stepIndex,
      deterministic: input.deterministic,
      action: input.action,
      risk: input.risk,
      reason: input.reason,
      permission: input.permission,
      tool: input.tool,
      path: input.path,
      checkpointRequired: input.checkpointRequired,
      matchedRule: input.matchedRule,
      shadow: input.shadow,
    })
  }

  function compact(input: Record<string, unknown>): ReplayEvent {
    return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as ReplayEvent
  }
}
