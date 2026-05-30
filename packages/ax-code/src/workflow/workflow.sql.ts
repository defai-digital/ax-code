import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import { SessionTable, TaskQueueTable } from "../session/session.sql"
import { Timestamps } from "../storage/schema.sql"
import type { SessionID, TaskQueueID } from "../session/schema"
import type { ProjectID } from "../project/schema"
import type {
  WorkflowArtifactRecord,
  WorkflowBudgetLedgerEntry,
  WorkflowBudgetUsage,
  WorkflowChildRecord,
  WorkflowPhaseRecord,
  WorkflowRunID,
  WorkflowRunRecord,
} from "./state"
import type { WorkflowBudget, WorkflowSpecV1 } from "./spec"

export const WorkflowRunTable = sqliteTable(
  "workflow_run",
  {
    id: text().$type<WorkflowRunID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    directory: text().notNull(),
    parent_session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    source_template_id: text(),
    status: text().$type<WorkflowRunRecord["status"]>().notNull(),
    current_phase_id: text(),
    spec_snapshot: text({ mode: "json" }).$type<WorkflowSpecV1>().notNull(),
    budget: text({ mode: "json" }).$type<WorkflowBudget>().notNull(),
    budget_usage: text({ mode: "json" }).$type<WorkflowBudgetUsage>().notNull(),
    verification_envelope_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    error: text(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_run_project_status_idx").on(table.project_id, table.status),
    index("workflow_run_project_created_idx").on(table.project_id, table.time_created, table.id),
    index("workflow_run_parent_session_idx").on(table.parent_session_id),
  ],
)

export const WorkflowPhaseTable = sqliteTable(
  "workflow_phase",
  {
    id: text().$type<WorkflowPhaseRecord["id"]>().primaryKey(),
    run_id: text()
      .$type<WorkflowRunID>()
      .notNull()
      .references(() => WorkflowRunTable.id, { onDelete: "cascade" }),
    spec_phase_id: text().notNull(),
    position: integer().notNull(),
    name: text().notNull(),
    kind: text().notNull(),
    status: text().$type<WorkflowPhaseRecord["status"]>().notNull(),
    agent: text(),
    model_policy: text({ mode: "json" }).$type<WorkflowPhaseRecord["modelPolicy"]>(),
    budget: text({ mode: "json" }).$type<WorkflowPhaseRecord["budget"]>(),
    outputs: text({ mode: "json" }).$type<string[]>().notNull(),
    error: text(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_phase_run_position_idx").on(table.run_id, table.position),
    index("workflow_phase_run_status_idx").on(table.run_id, table.status),
  ],
)

export const WorkflowChildTable = sqliteTable(
  "workflow_child",
  {
    id: text().$type<WorkflowChildRecord["id"]>().primaryKey(),
    run_id: text()
      .$type<WorkflowRunID>()
      .notNull()
      .references(() => WorkflowRunTable.id, { onDelete: "cascade" }),
    phase_id: text()
      .$type<WorkflowPhaseRecord["id"]>()
      .notNull()
      .references(() => WorkflowPhaseTable.id, { onDelete: "cascade" }),
    task_queue_id: text()
      .$type<TaskQueueID>()
      .references(() => TaskQueueTable.id, { onDelete: "set null" }),
    session_id: text()
      .$type<SessionID>()
      .references(() => SessionTable.id, { onDelete: "set null" }),
    status: text().$type<WorkflowChildRecord["status"]>().notNull(),
    agent: text(),
    model: text({ mode: "json" }).$type<unknown>(),
    budget_slice: text({ mode: "json" }).$type<WorkflowChildRecord["budgetSlice"]>(),
    artifact_ids: text({ mode: "json" }).$type<string[]>().notNull(),
    evidence_refs: text({ mode: "json" }).$type<WorkflowChildRecord["evidenceRefs"]>().notNull(),
    output_summary: text(),
    error: text(),
    time_started: integer(),
    time_completed: integer(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_child_run_phase_idx").on(table.run_id, table.phase_id),
    index("workflow_child_run_status_idx").on(table.run_id, table.status),
    index("workflow_child_task_queue_idx").on(table.task_queue_id),
  ],
)

export const WorkflowArtifactTable = sqliteTable(
  "workflow_artifact",
  {
    id: text().$type<WorkflowArtifactRecord["id"]>().primaryKey(),
    run_id: text()
      .$type<WorkflowRunID>()
      .notNull()
      .references(() => WorkflowRunTable.id, { onDelete: "cascade" }),
    phase_id: text()
      .$type<WorkflowPhaseRecord["id"]>()
      .references(() => WorkflowPhaseTable.id, { onDelete: "set null" }),
    child_id: text()
      .$type<WorkflowChildRecord["id"]>()
      .references(() => WorkflowChildTable.id, { onDelete: "set null" }),
    spec_artifact_id: text(),
    kind: text().$type<WorkflowArtifactRecord["kind"]>().notNull(),
    retention: text().$type<WorkflowArtifactRecord["retention"]>().notNull(),
    expose_to_main_context: integer({ mode: "boolean" }).notNull(),
    summary: text(),
    payload: text({ mode: "json" }).$type<unknown>(),
    redaction: text({ mode: "json" }).$type<WorkflowArtifactRecord["redaction"]>(),
    evidence_refs: text({ mode: "json" }).$type<WorkflowArtifactRecord["evidenceRefs"]>().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_artifact_run_idx").on(table.run_id, table.time_created, table.id),
    index("workflow_artifact_phase_idx").on(table.phase_id),
    index("workflow_artifact_child_idx").on(table.child_id),
  ],
)

export const WorkflowBudgetLedgerTable = sqliteTable(
  "workflow_budget_ledger",
  {
    id: text().$type<WorkflowBudgetLedgerEntry["id"]>().primaryKey(),
    run_id: text()
      .$type<WorkflowRunID>()
      .notNull()
      .references(() => WorkflowRunTable.id, { onDelete: "cascade" }),
    phase_id: text()
      .$type<WorkflowPhaseRecord["id"]>()
      .references(() => WorkflowPhaseTable.id, { onDelete: "set null" }),
    child_id: text()
      .$type<WorkflowChildRecord["id"]>()
      .references(() => WorkflowChildTable.id, { onDelete: "set null" }),
    kind: text().$type<WorkflowBudgetLedgerEntry["kind"]>().notNull(),
    usage_delta: text({ mode: "json" }).$type<WorkflowBudgetUsage>().notNull(),
    message: text(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_budget_ledger_run_idx").on(table.run_id, table.time_created, table.id),
    index("workflow_budget_ledger_phase_idx").on(table.phase_id),
    index("workflow_budget_ledger_child_idx").on(table.child_id),
  ],
)
