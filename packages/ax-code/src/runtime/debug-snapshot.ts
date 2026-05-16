import z from "zod"
import { RuntimeFailureClass } from "./failure-class"
import { ServiceManager } from "./service-manager"

export namespace RuntimeDebugSnapshot {
  export const Trigger = z
    .enum(["startup", "live_update", "workspace_switch", "reload", "shutdown", "service_failure", "timeout"])
    .describe("Lifecycle or diagnostic trigger that caused the snapshot to be emitted")
  export type Trigger = z.infer<typeof Trigger>

  export const QueueOverflowPolicy = z
    .enum(["drop_oldest", "drop_newest", "block", "coalesce"])
    .describe("Overflow policy for a bounded queue")
  export type QueueOverflowPolicy = z.infer<typeof QueueOverflowPolicy>

  export const QueueCoalescingPolicy = z
    .enum(["none", "message_part_delta", "resize_latest", "custom"])
    .describe("Coalescing policy applied to queued events")
  export type QueueCoalescingPolicy = z.infer<typeof QueueCoalescingPolicy>

  export const InstanceContext = z
    .object({
      directory: z.string().describe("Current working directory for the interactive instance"),
      worktree: z.string().optional().describe("Resolved worktree for the current interactive instance when known"),
      projectID: z.string().optional().describe("Project identifier when it is already known"),
    })
    .strict()
  export type InstanceContext = z.infer<typeof InstanceContext>

  export const QueueMetrics = z
    .object({
      name: z.string().min(1).describe("Stable queue name"),
      currentDepth: z.number().int().nonnegative().describe("Current queue depth"),
      maxDepth: z.number().int().positive().describe("Configured maximum queue depth"),
      highWaterMark: z.number().int().nonnegative().describe("Highest observed queue depth"),
      droppedEvents: z.number().int().nonnegative().describe("Count of dropped events"),
      coalescedEvents: z.number().int().nonnegative().describe("Count of coalesced events"),
      lastFlushDurationMs: z
        .number()
        .nonnegative()
        .optional()
        .describe("Last queue flush duration in milliseconds when available"),
      overflowPolicy: QueueOverflowPolicy.describe("Overflow policy applied when the queue is full"),
      coalescingPolicy: QueueCoalescingPolicy.describe("Coalescing policy applied to queued events"),
    })
    .strict()
  export type QueueMetrics = z.infer<typeof QueueMetrics>

  export const Snapshot = z
    .object({
      trigger: Trigger.describe("Reason the snapshot was emitted"),
      time: z.number().int().nonnegative().describe("Unix time in milliseconds when the snapshot was captured"),
      failureClass: RuntimeFailureClass.Kind.optional().describe("Failure class assigned to the snapshot when known"),
      instance: InstanceContext.optional().describe("Current instance metadata when available"),
      services: z.array(ServiceManager.ServiceStatus).describe("Runtime service rows included in the snapshot"),
      tasks: z.array(ServiceManager.BackgroundTaskStatus).describe("Background task rows included in the snapshot"),
      queues: z.array(QueueMetrics).describe("Bounded queue metrics included in the snapshot"),
    })
    .strict()
  export type Snapshot = z.infer<typeof Snapshot>

  export function create(input: {
    trigger: Trigger
    time: number
    failureClass?: RuntimeFailureClass.Kind
    instance?: InstanceContext
    services?: ServiceManager.ServiceStatus[]
    tasks?: ServiceManager.BackgroundTaskStatus[]
    queues?: QueueMetrics[]
  }): Snapshot {
    return Snapshot.parse({
      trigger: input.trigger,
      time: input.time,
      failureClass: input.failureClass,
      instance: input.instance,
      services: input.services ?? [],
      tasks: input.tasks ?? [],
      queues: input.queues ?? [],
    })
  }
}
