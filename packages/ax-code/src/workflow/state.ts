import z from "zod"
import { BusEvent } from "../bus/bus-event"
import { Identifier } from "../id/id"
import { ProjectID } from "../project/schema"
import { ENVELOPE_ID_PATTERN } from "../quality/verification-envelope"
import { SessionID, TaskQueueID } from "../session/schema"
import { WorkflowInputValues, WorkflowSpecV1, type WorkflowBudget, type WorkflowPhaseBudget } from "./spec"

type Brand<T extends string> = string & { readonly __brand: T }

function idSchema<Output extends string>(kind: Parameters<typeof Identifier.schema>[0]) {
  return Identifier.schema(kind).pipe(z.custom<Output>())
}

export type WorkflowRunID = Brand<"WorkflowRunID">
export const WorkflowRunID = {
  zod: idSchema<WorkflowRunID>("workflow_run"),
  ascending: (id?: string) => Identifier.ascending("workflow_run", id) as WorkflowRunID,
}

export type WorkflowPhaseID = Brand<"WorkflowPhaseID">
export const WorkflowPhaseID = {
  zod: idSchema<WorkflowPhaseID>("workflow_phase"),
  ascending: (id?: string) => Identifier.ascending("workflow_phase", id) as WorkflowPhaseID,
}

export type WorkflowChildID = Brand<"WorkflowChildID">
export const WorkflowChildID = {
  zod: idSchema<WorkflowChildID>("workflow_child"),
  ascending: (id?: string) => Identifier.ascending("workflow_child", id) as WorkflowChildID,
}

export type WorkflowArtifactID = Brand<"WorkflowArtifactID">
export const WorkflowArtifactID = {
  zod: idSchema<WorkflowArtifactID>("workflow_artifact"),
  ascending: (id?: string) => Identifier.ascending("workflow_artifact", id) as WorkflowArtifactID,
}

export type WorkflowBudgetLedgerID = Brand<"WorkflowBudgetLedgerID">
export const WorkflowBudgetLedgerID = {
  zod: idSchema<WorkflowBudgetLedgerID>("workflow_budget"),
  ascending: (id?: string) => Identifier.ascending("workflow_budget", id) as WorkflowBudgetLedgerID,
}

const TimestampInfo = z.object({
  created: z.number(),
  updated: z.number(),
  started: z.number().optional(),
  completed: z.number().optional(),
})

export const WorkflowEvidenceRef = z.object({
  kind: z.enum(["artifact", "verification", "finding", "debug-evidence"]),
  id: z.string().min(1),
})
export type WorkflowEvidenceRef = z.infer<typeof WorkflowEvidenceRef>

export const WorkflowUsageDelta = z.object({
  totalTokens: z.number().int().min(0).default(0),
  inputTokens: z.number().int().min(0).default(0),
  outputTokens: z.number().int().min(0).default(0),
  toolCalls: z.number().int().min(0).default(0),
  childAgents: z.number().int().min(0).default(0),
  retries: z.number().int().min(0).default(0),
})
export type WorkflowBudgetUsage = z.infer<typeof WorkflowUsageDelta>

export const EmptyWorkflowBudgetUsage: WorkflowBudgetUsage = {
  totalTokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  toolCalls: 0,
  childAgents: 0,
  retries: 0,
}

export namespace WorkflowRun {
  export const Status = z.enum(["queued", "running", "blocked", "paused", "failed", "completed", "cancelled"])
  export type Status = z.infer<typeof Status>

  export const PhaseStatus = z.enum(["queued", "running", "blocked", "paused", "failed", "completed", "cancelled"])
  export type PhaseStatus = z.infer<typeof PhaseStatus>

  export const ChildStatus = z.enum([
    "queued",
    "running",
    "blocked_permission",
    "blocked_question",
    "paused",
    "failed",
    "completed",
    "cancelled",
  ])
  export type ChildStatus = z.infer<typeof ChildStatus>

  export const ArtifactKind = z.enum(["summary", "finding", "patch", "verification", "metric", "log"])
  export type ArtifactKind = z.infer<typeof ArtifactKind>

  export const ArtifactRetention = z.enum(["ephemeral", "session", "durable"])
  export type ArtifactRetention = z.infer<typeof ArtifactRetention>

  export const BudgetLedgerKind = z.enum(["reserve", "consume", "warn", "exceeded", "correction"])
  export type BudgetLedgerKind = z.infer<typeof BudgetLedgerKind>

  export const Record = z.object({
    id: WorkflowRunID.zod,
    projectID: ProjectID.zod,
    directory: z.string(),
    parentSessionID: SessionID.zod.optional(),
    sourceTemplateID: z.string().optional(),
    sourceTaskID: z.string().min(1).optional(),
    status: Status,
    currentPhaseID: WorkflowPhaseID.zod.optional(),
    spec: WorkflowSpecV1,
    inputValues: WorkflowInputValues,
    budget: z.custom<WorkflowBudget>(),
    budgetUsage: WorkflowUsageDelta,
    verificationEnvelopeIDs: z.array(z.string().regex(ENVELOPE_ID_PATTERN)),
    error: z.string().optional(),
    time: TimestampInfo,
  })
  export type Info = z.infer<typeof Record>
}

export type WorkflowRunRecord = WorkflowRun.Info

export const WorkflowPhaseRecord = z.object({
  id: WorkflowPhaseID.zod,
  runID: WorkflowRunID.zod,
  specPhaseID: z.string().min(1),
  position: z.number().int().min(0),
  name: z.string().min(1),
  kind: z.enum(["fanout", "sequential", "synthesis", "verification", "noop"]),
  status: WorkflowRun.PhaseStatus,
  agent: z.string().optional(),
  modelPolicy: z.unknown().optional(),
  budget: z.custom<WorkflowPhaseBudget>().optional(),
  outputs: z.array(z.string()),
  error: z.string().optional(),
  time: TimestampInfo,
})
export type WorkflowPhaseRecord = z.infer<typeof WorkflowPhaseRecord>

export const WorkflowChildRecord = z.object({
  id: WorkflowChildID.zod,
  runID: WorkflowRunID.zod,
  phaseID: WorkflowPhaseID.zod,
  taskQueueID: TaskQueueID.zod.optional(),
  sessionID: SessionID.zod.optional(),
  status: WorkflowRun.ChildStatus,
  agent: z.string().optional(),
  model: z.unknown().optional(),
  budgetSlice: z.custom<WorkflowPhaseBudget>().optional(),
  artifactIDs: z.array(WorkflowArtifactID.zod),
  evidenceRefs: z.array(WorkflowEvidenceRef),
  outputSummary: z.string().optional(),
  error: z.string().optional(),
  time: TimestampInfo,
})
export type WorkflowChildRecord = z.infer<typeof WorkflowChildRecord>

export const WorkflowArtifactRecord = z.object({
  id: WorkflowArtifactID.zod,
  runID: WorkflowRunID.zod,
  phaseID: WorkflowPhaseID.zod.optional(),
  childID: WorkflowChildID.zod.optional(),
  specArtifactID: z.string().min(1).optional(),
  kind: WorkflowRun.ArtifactKind,
  retention: WorkflowRun.ArtifactRetention,
  exposeToMainContext: z.boolean(),
  summary: z.string().optional(),
  payload: z.unknown().optional(),
  redaction: z
    .object({
      status: z.enum(["none", "redacted", "pending"]).default("pending"),
      summary: z.string().optional(),
    })
    .optional(),
  evidenceRefs: z.array(WorkflowEvidenceRef),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})
export type WorkflowArtifactRecord = z.infer<typeof WorkflowArtifactRecord>

export const WorkflowBudgetLedgerEntry = z.object({
  id: WorkflowBudgetLedgerID.zod,
  runID: WorkflowRunID.zod,
  phaseID: WorkflowPhaseID.zod.optional(),
  childID: WorkflowChildID.zod.optional(),
  kind: WorkflowRun.BudgetLedgerKind,
  usageDelta: WorkflowUsageDelta,
  message: z.string().optional(),
  time: z.object({
    created: z.number(),
    updated: z.number(),
  }),
})
export type WorkflowBudgetLedgerEntry = z.infer<typeof WorkflowBudgetLedgerEntry>

const WorkflowWireID = z.string().min(1)

export const WorkflowRunEventRecord = z
  .object({
    id: WorkflowWireID,
    projectID: WorkflowWireID,
    directory: z.string(),
    parentSessionID: WorkflowWireID.optional(),
    sourceTemplateID: z.string().optional(),
    sourceTaskID: z.string().optional(),
    status: WorkflowRun.Status,
    currentPhaseID: WorkflowWireID.optional(),
    spec: WorkflowSpecV1,
    inputValues: WorkflowInputValues,
    budget: z.record(z.string(), z.unknown()),
    budgetUsage: WorkflowUsageDelta,
    verificationEnvelopeIDs: z.array(z.string()),
    error: z.string().optional(),
    time: TimestampInfo,
  })
  .meta({ ref: "WorkflowRunEventRecord" })

export const WorkflowPhaseEventRecord = z
  .object({
    id: WorkflowWireID,
    runID: WorkflowWireID,
    specPhaseID: z.string().min(1),
    position: z.number().int().min(0),
    name: z.string().min(1),
    kind: z.enum(["fanout", "sequential", "synthesis", "verification", "noop"]),
    status: WorkflowRun.PhaseStatus,
    agent: z.string().optional(),
    modelPolicy: z.unknown().optional(),
    budget: z.unknown().optional(),
    outputs: z.array(z.string()),
    error: z.string().optional(),
    time: TimestampInfo,
  })
  .meta({ ref: "WorkflowPhaseEventRecord" })

export const WorkflowChildEventRecord = z
  .object({
    id: WorkflowWireID,
    runID: WorkflowWireID,
    phaseID: WorkflowWireID,
    taskQueueID: WorkflowWireID.optional(),
    sessionID: WorkflowWireID.optional(),
    status: WorkflowRun.ChildStatus,
    agent: z.string().optional(),
    model: z.unknown().optional(),
    budgetSlice: z.unknown().optional(),
    artifactIDs: z.array(WorkflowWireID),
    evidenceRefs: z.array(WorkflowEvidenceRef),
    outputSummary: z.string().optional(),
    error: z.string().optional(),
    time: TimestampInfo,
  })
  .meta({ ref: "WorkflowChildEventRecord" })

export const WorkflowArtifactEventRecord = z
  .object({
    id: WorkflowWireID,
    runID: WorkflowWireID,
    phaseID: WorkflowWireID.optional(),
    childID: WorkflowWireID.optional(),
    specArtifactID: z.string().min(1).optional(),
    kind: WorkflowRun.ArtifactKind,
    retention: WorkflowRun.ArtifactRetention,
    exposeToMainContext: z.boolean(),
    summary: z.string().optional(),
    payload: z.unknown().optional(),
    redaction: WorkflowArtifactRecord.shape.redaction,
    evidenceRefs: z.array(WorkflowEvidenceRef),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  .meta({ ref: "WorkflowArtifactEventRecord" })

export const WorkflowArtifactCompactEventRecord = WorkflowArtifactEventRecord.omit({ payload: true }).meta({
  ref: "WorkflowArtifactCompactEventRecord",
})

export const WorkflowBudgetLedgerEventEntry = z
  .object({
    id: WorkflowWireID,
    runID: WorkflowWireID,
    phaseID: WorkflowWireID.optional(),
    childID: WorkflowWireID.optional(),
    kind: WorkflowRun.BudgetLedgerKind,
    usageDelta: WorkflowUsageDelta,
    message: z.string().optional(),
    time: z.object({
      created: z.number(),
      updated: z.number(),
    }),
  })
  .meta({ ref: "WorkflowBudgetLedgerEventEntry" })

export const WorkflowVerificationAttachedEventRecord = z
  .object({
    runID: WorkflowWireID,
    envelopeIDs: z.array(z.string()),
    run: WorkflowRunEventRecord,
  })
  .meta({ ref: "WorkflowVerificationAttachedEventRecord" })

export const WorkflowRunDetail = WorkflowRun.Record.extend({
  phases: z.array(WorkflowPhaseRecord),
  children: z.array(WorkflowChildRecord),
  artifacts: z.array(WorkflowArtifactRecord),
  budgetLedger: z.array(WorkflowBudgetLedgerEntry),
})
export type WorkflowRunDetail = z.infer<typeof WorkflowRunDetail>

export namespace WorkflowRun {
  export const CreateInput = z.object({
    parentSessionID: SessionID.zod.optional(),
    sourceTemplateID: z.string().trim().min(1).optional(),
    sourceTaskID: z.string().trim().min(1).optional(),
    spec: WorkflowSpecV1,
    inputValues: WorkflowInputValues,
  })
  export type CreateInput = z.input<typeof CreateInput>

  export const ListInput = z.object({
    parentSessionID: SessionID.zod.optional(),
    status: Status.optional(),
    limit: z.number().int().positive().max(500).optional(),
  })
  export type ListInput = z.infer<typeof ListInput>

  export const SetStatusInput = z.object({
    id: WorkflowRunID.zod,
    status: Status,
    error: z.string().optional(),
  })
  export type SetStatusInput = z.infer<typeof SetStatusInput>

  export const SetPhaseStatusInput = z.object({
    id: WorkflowPhaseID.zod,
    status: PhaseStatus,
    error: z.string().optional(),
  })
  export type SetPhaseStatusInput = z.infer<typeof SetPhaseStatusInput>

  export const AppendChildInput = z.object({
    runID: WorkflowRunID.zod,
    phaseID: WorkflowPhaseID.zod,
    taskQueueID: TaskQueueID.zod.optional(),
    sessionID: SessionID.zod.optional(),
    agent: z.string().optional(),
    model: z.unknown().optional(),
    budgetSlice: z.custom<WorkflowPhaseBudget>().optional(),
  })
  export type AppendChildInput = z.infer<typeof AppendChildInput>

  export const SetChildStatusInput = z.object({
    id: WorkflowChildID.zod,
    status: ChildStatus,
    outputSummary: z.string().optional(),
    artifactIDs: z.array(WorkflowArtifactID.zod).optional(),
    evidenceRefs: z.array(WorkflowEvidenceRef).optional(),
    error: z.string().optional(),
  })
  export type SetChildStatusInput = z.infer<typeof SetChildStatusInput>

  export const AttachChildTaskQueueInput = z.object({
    id: WorkflowChildID.zod,
    taskQueueID: TaskQueueID.zod,
  })
  export type AttachChildTaskQueueInput = z.infer<typeof AttachChildTaskQueueInput>

  export const AppendArtifactInput = z.object({
    runID: WorkflowRunID.zod,
    phaseID: WorkflowPhaseID.zod.optional(),
    childID: WorkflowChildID.zod.optional(),
    specArtifactID: z.string().min(1).optional(),
    kind: ArtifactKind,
    retention: ArtifactRetention.default("session"),
    exposeToMainContext: z.boolean().default(false),
    summary: z.string().optional(),
    payload: z.unknown().optional(),
    redaction: WorkflowArtifactRecord.shape.redaction,
    evidenceRefs: z.array(WorkflowEvidenceRef).default([]),
  })
  export type AppendArtifactInput = z.input<typeof AppendArtifactInput>

  export const AppendBudgetUsageInput = z.object({
    runID: WorkflowRunID.zod,
    phaseID: WorkflowPhaseID.zod.optional(),
    childID: WorkflowChildID.zod.optional(),
    kind: BudgetLedgerKind,
    usageDelta: WorkflowUsageDelta.default(EmptyWorkflowBudgetUsage),
    message: z.string().optional(),
  })
  export type AppendBudgetUsageInput = z.input<typeof AppendBudgetUsageInput>

  export const AttachVerificationInput = z.object({
    id: WorkflowRunID.zod,
    envelopeIDs: z.array(z.string().regex(ENVELOPE_ID_PATTERN)).min(1),
  })
  export type AttachVerificationInput = z.infer<typeof AttachVerificationInput>

  export const Event = {
    Created: BusEvent.define("workflow.run.created", z.object({ run: WorkflowRunEventRecord })),
    Updated: BusEvent.define("workflow.run.updated", z.object({ run: WorkflowRunEventRecord })),
    Started: BusEvent.define("workflow.run.started", z.object({ run: WorkflowRunEventRecord })),
    Blocked: BusEvent.define("workflow.run.blocked", z.object({ run: WorkflowRunEventRecord })),
    Paused: BusEvent.define("workflow.run.paused", z.object({ run: WorkflowRunEventRecord })),
    Resumed: BusEvent.define("workflow.run.resumed", z.object({ run: WorkflowRunEventRecord })),
    Completed: BusEvent.define("workflow.run.completed", z.object({ run: WorkflowRunEventRecord })),
    Failed: BusEvent.define("workflow.run.failed", z.object({ run: WorkflowRunEventRecord })),
    Cancelled: BusEvent.define("workflow.run.cancelled", z.object({ run: WorkflowRunEventRecord })),
    PhaseUpdated: BusEvent.define("workflow.phase.updated", z.object({ phase: WorkflowPhaseEventRecord })),
    PhaseStarted: BusEvent.define("workflow.phase.started", z.object({ phase: WorkflowPhaseEventRecord })),
    PhaseCompleted: BusEvent.define("workflow.phase.completed", z.object({ phase: WorkflowPhaseEventRecord })),
    PhaseFailed: BusEvent.define("workflow.phase.failed", z.object({ phase: WorkflowPhaseEventRecord })),
    ChildCreated: BusEvent.define("workflow.child.created", z.object({ child: WorkflowChildEventRecord })),
    ChildUpdated: BusEvent.define("workflow.child.updated", z.object({ child: WorkflowChildEventRecord })),
    ChildStarted: BusEvent.define("workflow.child.started", z.object({ child: WorkflowChildEventRecord })),
    ChildCompleted: BusEvent.define("workflow.child.completed", z.object({ child: WorkflowChildEventRecord })),
    ChildFailed: BusEvent.define("workflow.child.failed", z.object({ child: WorkflowChildEventRecord })),
    ChildCancelled: BusEvent.define("workflow.child.cancelled", z.object({ child: WorkflowChildEventRecord })),
    ArtifactWritten: BusEvent.define(
      "workflow.artifact.written",
      z.object({ artifact: WorkflowArtifactCompactEventRecord }),
    ),
    BudgetAppended: BusEvent.define("workflow.budget.appended", z.object({ entry: WorkflowBudgetLedgerEventEntry })),
    BudgetWarning: BusEvent.define(
      "workflow.budget.warning",
      z.object({ entry: WorkflowBudgetLedgerEventEntry, warnings: z.array(z.string()) }),
    ),
    BudgetExceeded: BusEvent.define(
      "workflow.budget.exceeded",
      z.object({ entry: WorkflowBudgetLedgerEventEntry, exceeded: z.array(z.string()) }),
    ),
    VerificationAttached: BusEvent.define(
      "workflow.verification.attached",
      z.object({ verification: WorkflowVerificationAttachedEventRecord }),
    ),
  }
}
