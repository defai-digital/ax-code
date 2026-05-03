import { AgentControlSummary } from "@/control-plane/agent-control-summary"
import type { SessionID } from "@/session/schema"
import type { ReplayEvent } from "./event"
import { EventQuery } from "./query"
import { ToolCallReplayQuery } from "./tool-call-query"

export namespace AgentControlReplayQuery {
  const DETAIL_SEPARATOR = " \u00B7 "
  const PHASES = new Set([
    "assess",
    "plan",
    "await_approval",
    "execute",
    "validate",
    "recover",
    "summarize",
    "complete",
    "blocked",
  ])
  const REASONING_DEPTHS = new Set(["fast", "standard", "deep", "xdeep"])
  const VALIDATION_STATUSES = new Set(["not_required", "pending", "passed", "failed"])
  const SAFETY_ACTIONS = new Set(["allow", "ask", "deny", "allow_with_checkpoint"])
  const SAFETY_RISKS = new Set(["safe", "low", "medium", "high", "blocked"])

  export type TimelineTone = "muted" | "working" | "warning" | "success"
  export type TimelineKind = "phase" | "reasoning" | "plan" | "validation" | "blocked" | "completed" | "safety"

  export interface TimelineItem {
    id: string
    eventType: string
    kind: TimelineKind
    title: string
    status: string
    tone: TimelineTone
    time?: number
    detail?: string
    shadow?: boolean
  }

  export interface TimelineRow {
    event_data: unknown
    time_created: number
  }

  export interface ReadModel {
    summary: ReturnType<typeof AgentControlSummary.fromEvents>
    timeline: TimelineItem[]
    tools: ToolCallReplayQuery.Summary
  }

  export function normalizeAgentControlEvent(event: unknown): ReplayEvent | undefined {
    const record = asRecord(event)
    const type = asString(record.type)
    if (!type) return undefined
    const normalized: Record<string, unknown> = {
      ...record,
      ...asRecord(record.properties),
      type,
    }
    switch (type) {
      case "agent.phase.changed":
        return isKnown(PHASES, normalized.phase) ? (normalized as ReplayEvent) : undefined
      case "agent.reasoning.selected":
        return isKnown(REASONING_DEPTHS, normalized.depth) ? (normalized as ReplayEvent) : undefined
      case "agent.plan.created":
      case "agent.plan.updated":
        return isPlanArtifactLike(normalized.plan) ? (normalized as ReplayEvent) : undefined
      case "agent.validation.updated":
        return isKnown(VALIDATION_STATUSES, normalized.status) ? (normalized as ReplayEvent) : undefined
      case "agent.blocked":
        return asString(normalized.reason) ? (normalized as ReplayEvent) : undefined
      case "agent.completed":
        return asString(normalized.validationStatus) === "not_required" || asString(normalized.validationStatus) === "passed"
          ? (normalized as ReplayEvent)
          : undefined
      case "agent.safety.decided":
        return isKnown(SAFETY_ACTIONS, normalized.action) &&
          isKnown(SAFETY_RISKS, normalized.risk) &&
          asString(normalized.reason)
          ? (normalized as ReplayEvent)
          : undefined
      default:
        return undefined
    }
  }

  export function isAgentControlEvent(event: unknown): boolean {
    return !!normalizeAgentControlEvent(event)
  }

  export function summaryBySession(sessionID: SessionID) {
    const rows = EventQuery.bySessionWithTimestamp(sessionID)
    return summaryFromRows(rows)
  }

  export function readModelBySession(sessionID: SessionID): ReadModel {
    const rows = EventQuery.bySessionWithTimestamp(sessionID)
    return readModelFromRows(rows, sessionID)
  }

  export function readModelFromRows(rows: readonly TimelineRow[], idPrefix = "event"): ReadModel {
    return {
      summary: summaryFromRows(rows),
      timeline: timelineFromRows(rows, idPrefix),
      tools: ToolCallReplayQuery.summaryFromRows(rows),
    }
  }

  export function readModelFromEvents(events: readonly unknown[], idPrefix = "event"): ReadModel {
    return {
      summary: summaryFromEvents(events),
      timeline: timelineFromEvents(events, idPrefix),
      tools: ToolCallReplayQuery.summaryFromEvents(events),
    }
  }

  export function summaryFromRows(rows: readonly Pick<TimelineRow, "event_data">[]) {
    return summaryFromEvents(rows.map((row) => row.event_data))
  }

  export function summaryFromEvents(events: readonly unknown[]) {
    return AgentControlSummary.fromEvents(events.map(normalizeAgentControlEvent).filter(isDefined))
  }

  export function timelineBySession(sessionID: SessionID) {
    const rows = EventQuery.bySessionWithTimestamp(sessionID)
    return timelineFromRows(rows, sessionID)
  }

  export function timelineFromRows(rows: readonly TimelineRow[], idPrefix = "event") {
    return rows.flatMap((row, index) => {
      const item = timelineItemFromEvent(row.event_data, `${idPrefix}:${row.time_created}:${index}`)
      return item ? [{ ...item, time: row.time_created }] : []
    })
  }

  export function timelineFromEvents(events: readonly unknown[], idPrefix = "event") {
    return events.flatMap((event, index) => {
      const item = timelineItemFromEvent(event, `${idPrefix}:${index}`)
      return item ? [item] : []
    })
  }

  export function timelineItemFromEvent(event: unknown, id: string): TimelineItem | undefined {
    const normalized = normalizeAgentControlEvent(event)
    if (!normalized) return undefined
    const record = asRecord(normalized)
    const eventType = asString(record.type)
    const properties = record
    if (!eventType) return undefined

    switch (eventType) {
      case "agent.phase.changed": {
        const phase = asString(properties.phase) ?? "unknown"
        return {
          id,
          eventType,
          kind: "phase",
          title: `Phase: ${titlecase(phase)}`,
          status: phase,
          tone: phase === "complete" ? "success" : phase === "blocked" ? "warning" : "working",
          detail: asString(properties.reason),
        }
      }
      case "agent.reasoning.selected": {
        const depth = asString(properties.depth) ?? "standard"
        const reason = asString(properties.reason)
        const detail =
          properties.checkpoint === true && reason
            ? `${reason}${DETAIL_SEPARATOR}checkpoint`
            : properties.checkpoint === true
              ? "checkpoint"
              : reason
        return {
          id,
          eventType,
          kind: "reasoning",
          title: `Reasoning: ${titlecase(depth)}`,
          status: depth,
          tone: depth === "fast" || depth === "standard" ? "muted" : "working",
          detail,
        }
      }
      case "agent.plan.created":
      case "agent.plan.updated": {
        const plan = asRecord(properties.plan)
        const objective = asString(plan.objective)
        const status = asString(plan.approvalState) ?? "pending"
        return {
          id,
          eventType,
          kind: "plan",
          title: objective ? `Plan: ${truncate(objective)}` : eventType === "agent.plan.created" ? "Plan created" : "Plan updated",
          status,
          tone: planTone(plan, status),
          detail: [planProgressLabel(plan), `approval ${status}`].filter(Boolean).join(DETAIL_SEPARATOR) || undefined,
        }
      }
      case "agent.validation.updated": {
        const status = asString(properties.status) ?? "unknown"
        return {
          id,
          eventType,
          kind: "validation",
          title: `Validation: ${titlecase(status)}`,
          status,
          tone: status === "passed" || status === "not_required" ? "success" : status === "failed" ? "warning" : "working",
          detail: asString(properties.reason),
        }
      }
      case "agent.blocked": {
        const reason = asString(properties.reason)
        return {
          id,
          eventType,
          kind: "blocked",
          title: "Blocked",
          status: "blocked",
          tone: "warning",
          detail: properties.recoverable === true && reason ? `${reason}${DETAIL_SEPARATOR}recoverable` : reason,
        }
      }
      case "agent.completed": {
        return {
          id,
          eventType,
          kind: "completed",
          title: "Completed",
          status: "completed",
          tone: "success",
          detail: asString(properties.summary) ?? `validation ${asString(properties.validationStatus) ?? "unknown"}`,
        }
      }
      case "agent.safety.decided": {
        const action = asString(properties.action) ?? "unknown"
        const risk = asString(properties.risk)
        const shadow = properties.shadow === true
        const detail = [asString(properties.permission), asString(properties.reason), asString(properties.matchedRule)]
          .filter(Boolean)
          .join(DETAIL_SEPARATOR)
        return {
          id,
          eventType,
          kind: "safety",
          title: shadow ? `Safety: Shadow ${safetyActionLabel(action)}` : `Safety: ${safetyActionLabel(action)}`,
          status: action,
          tone: action === "deny" || risk === "blocked" || risk === "high" ? "warning" : action === "allow" ? "success" : "working",
          detail: detail || undefined,
          shadow,
        }
      }
      default:
        return undefined
    }
  }

  function planProgressLabel(plan: Record<string, unknown>) {
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : []
    if (tasks.length === 0) return "no tasks"
    const completed = tasks.filter((task) => asRecord(task).status === "completed").length
    const blocked = tasks.filter((task) => asRecord(task).status === "blocked").length
    const blockedLabel = blocked > 0 ? `${DETAIL_SEPARATOR}${blocked} blocked` : ""
    return `${completed}/${tasks.length} tasks completed${blockedLabel}`
  }

  function planTone(plan: Record<string, unknown>, approvalState: string): TimelineTone {
    const tasks = Array.isArray(plan.tasks) ? plan.tasks : []
    if (approvalState === "rejected" || tasks.some((task) => asRecord(task).status === "blocked")) return "warning"
    return "working"
  }

  function safetyActionLabel(action: string): string {
    if (action === "allow_with_checkpoint") return "Checkpoint"
    return titlecase(action)
  }

  function titlecase(value: string): string {
    return value
      .replace(/_/g, " ")
      .replace(/\b\w/g, (item) => item.toUpperCase())
  }

  function truncate(value: string, length = 40): string {
    const normalized = value.replace(/\s+/g, " ").trim()
    if (normalized.length <= length) return normalized
    return `${normalized.slice(0, length - 3)}...`
  }

  function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  }

  function isPlanArtifactLike(value: unknown) {
    const plan = asRecord(value)
    return (
      !!asString(plan.id) &&
      !!asString(plan.objective) &&
      !!asString(plan.approvalState) &&
      Array.isArray(plan.tasks)
    )
  }

  function asString(value: unknown) {
    return typeof value === "string" && value.length > 0 ? value : undefined
  }

  function isKnown(values: Set<string>, value: unknown) {
    const candidate = asString(value)
    return !!candidate && values.has(candidate)
  }

  function isDefined<T>(value: T | undefined): value is T {
    return value !== undefined
  }
}
