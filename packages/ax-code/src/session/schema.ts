import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"
import z from "zod"

/**
 * Stable, machine-readable classifications for terminal session limits.
 *
 * Keep this separate from the coarse replay end reason (`step_limit`,
 * `error`, and so on): existing consumers can continue grouping by the old
 * reason while newer clients explain exactly which independent budget ended
 * the run.
 */
export namespace SessionStop {
  export const Code = z
    .enum([
      "MODEL_TURN_SEGMENT_LIMIT",
      "MODEL_TURN_TOTAL_LIMIT",
      "AGENT_MODEL_TURN_LIMIT",
      "AGGREGATE_TOOL_CALL_LIMIT",
      "FILE_CHANGE_LIMIT",
      "LINE_CHANGE_LIMIT",
    ])
    .meta({ ref: "SessionStopCode" })

  export type Code = z.infer<typeof Code>
}

export type SessionID = BrandedIdentifier<"SessionID">
export const SessionID = defineBrandedIdentifier("SessionID", "session")

export type MessageID = BrandedIdentifier<"MessageID">
export const MessageID = defineBrandedIdentifier("MessageID", "message")

export type PartID = BrandedIdentifier<"PartID">
export const PartID = defineBrandedIdentifier("PartID", "part")

export type TaskQueueID = BrandedIdentifier<"TaskQueueID">
export const TaskQueueID = defineBrandedIdentifier("TaskQueueID", "task_queue")

export type ScheduledTaskID = BrandedIdentifier<"ScheduledTaskID">
export const ScheduledTaskID = defineBrandedIdentifier("ScheduledTaskID", "scheduled_task")

export type ScheduledTaskRunID = BrandedIdentifier<"ScheduledTaskRunID">
export const ScheduledTaskRunID = defineBrandedIdentifier("ScheduledTaskRunID", "scheduled_task_run")
