import type { ReplayEvent } from "@/replay/event"

import { AgentControl } from "./agent-control"

export namespace AgentControlSummary {
  export type Summary = {
    phase?: AgentControl.Phase
    phaseReason?: string
    reasoningDepth?: AgentControl.ReasoningDepth
    reasoningReason?: string
    plan?: {
      id: string
      objective: string
      approvalState: AgentControl.ApprovalState
      progress: ReturnType<typeof AgentControl.planProgress>
    }
    validationStatus?: AgentControl.ValidationStatus
    blockedReason?: string
    completionGate?: {
      status: "allow" | "blocked"
      reason?: "none" | "empty_subagent_result" | "unfinished_todos"
      message?: string
    }
    completed?: boolean
    safety: {
      shadow: number
      ask: number
      deny: number
      checkpoint: number
    }
  }

  export function fromEvents(events: ReplayEvent[]): Summary {
    const summary: Summary = {
      safety: {
        shadow: 0,
        ask: 0,
        deny: 0,
        checkpoint: 0,
      },
    }

    for (const event of events) {
      switch (event.type) {
        case "agent.phase.changed":
          summary.phase = event.phase
          summary.phaseReason = event.reason
          break
        case "agent.reasoning.selected":
          summary.reasoningDepth = event.depth
          summary.reasoningReason = event.reason
          break
        case "agent.plan.created":
        case "agent.plan.updated":
          summary.plan = {
            id: event.plan.id,
            objective: event.plan.objective,
            approvalState: event.plan.approvalState,
            progress: AgentControl.planProgress(event.plan),
          }
          break
        case "agent.validation.updated":
          summary.validationStatus = event.status
          break
        case "agent.blocked":
          summary.phase = "blocked"
          summary.blockedReason = event.reason
          break
        case "agent.completion_gate.decided":
          summary.completionGate = {
            status: event.status,
            reason: event.reason,
            message: event.message,
          }
          if (event.status === "blocked") {
            summary.phase = "blocked"
            summary.blockedReason = event.reason ?? event.message
          }
          break
        case "agent.completed":
          summary.phase = "complete"
          summary.validationStatus = event.validationStatus
          summary.completed = true
          break
        case "agent.safety.decided":
          if (event.shadow) summary.safety.shadow++
          if (event.action === "ask") summary.safety.ask++
          if (event.action === "deny") summary.safety.deny++
          if (event.action === "allow_with_checkpoint") summary.safety.checkpoint++
          break
      }
    }

    return summary
  }

  export function statusLine(summary: Summary): string {
    const parts: string[] = []
    if (summary.phase) parts.push(`phase ${summary.phase}`)
    if (summary.reasoningDepth) parts.push(`reasoning ${summary.reasoningDepth}`)
    if (summary.plan) {
      const progress = summary.plan.progress
      parts.push(`plan ${progress.completed}/${progress.total}`)
    }
    if (summary.validationStatus) parts.push(`validation ${summary.validationStatus}`)
    if (summary.completionGate?.status === "allow") parts.push("completion gate passed")
    if (summary.completionGate?.status === "blocked") {
      parts.push(`completion gate blocked ${summary.completionGate.reason ?? "unknown"}`)
    }
    if (summary.blockedReason) parts.push(`blocked ${summary.blockedReason}`)
    if (summary.safety.shadow > 0) parts.push(`shadow safety ${summary.safety.shadow}`)
    return parts.join(" · ")
  }
}
