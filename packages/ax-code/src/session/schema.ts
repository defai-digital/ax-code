import { defineBrandedIdentifier, type BrandedIdentifier } from "@/id/branded"

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
