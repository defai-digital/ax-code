import { Database, NotFoundError, eq } from "../../storage/db"
import { addWorkflowBudgetUsage, evaluateWorkflowBudget, evaluateWorkflowChildBudget } from "../budget"
import {
  EmptyWorkflowBudgetUsage,
  WorkflowBudgetLedgerEntry,
  WorkflowBudgetLedgerID,
  WorkflowChildRecord,
  WorkflowPhaseRecord,
  WorkflowRun as WorkflowRunState,
} from "../state"
import { WorkflowBudgetLedgerTable, WorkflowChildTable, WorkflowPhaseTable, WorkflowRunTable } from "../workflow.sql"
import {
  fromBudgetLedgerRow,
  fromChildRow,
  fromPhaseRow,
  fromRunRow,
  getRun,
  assertChildBelongsToRun,
  assertPhaseBelongsToRun,
  isTerminalChildStatus,
  isTerminalPhaseStatus,
  isTerminalRunStatus,
  publishBudgetAppended,
  publishBudgetExceeded,
  publishBudgetWarning,
  publishChildUpdated,
  publishPhaseUpdated,
  publishUpdated,
} from "./internal"

export type AppendBudgetUsageChange = {
  entry: WorkflowBudgetLedgerEntry
  exceededEntry: WorkflowBudgetLedgerEntry | undefined
  failedRun: WorkflowRunState.Info | undefined
  failedRunPreviousStatus: WorkflowRunState.Status | undefined
  failedPhase: WorkflowPhaseRecord | undefined
  failedPhasePreviousStatus: WorkflowRunState.PhaseStatus | undefined
  failedChild: WorkflowChildRecord | undefined
  failedChildPreviousStatus: WorkflowRunState.ChildStatus | undefined
  warnings: string[]
  exceeded: string[]
}

export async function appendBudgetUsage(
  input: WorkflowRunState.AppendBudgetUsageInput,
): Promise<WorkflowBudgetLedgerEntry> {
  const parsed = WorkflowRunState.AppendBudgetUsageInput.parse(input)
  await getRun(parsed.runID)
  if (parsed.phaseID) await assertPhaseBelongsToRun(parsed.phaseID, parsed.runID)
  if (parsed.childID) await assertChildBelongsToRun(parsed.childID, parsed.runID)

  const now = Date.now()
  const changed = Database.transaction((db): AppendBudgetUsageChange => {
    const run = db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, parsed.runID)).get()
    if (!run) throw new NotFoundError({ message: `Workflow run not found: ${parsed.runID}` })
    const nextUsage = addWorkflowBudgetUsage(run.budget_usage, parsed.usageDelta)
    const workflowEvaluation = evaluateWorkflowBudget({
      budget: run.budget,
      usage: nextUsage,
      elapsedMs: now - (run.time_started ?? run.time_created),
    })
    const budgetChild = parsed.childID
      ? db.select().from(WorkflowChildTable).where(eq(WorkflowChildTable.id, parsed.childID)).get()
      : undefined
    const childUsage = parsed.childID
      ? addWorkflowBudgetUsage(
          db
            .select()
            .from(WorkflowBudgetLedgerTable)
            .where(eq(WorkflowBudgetLedgerTable.child_id, parsed.childID))
            .all()
            .reduce((usage, ledger) => addWorkflowBudgetUsage(usage, ledger.usage_delta), EmptyWorkflowBudgetUsage),
          parsed.usageDelta,
        )
      : undefined
    const childEvaluation = evaluateWorkflowChildBudget({
      budgetSlice: budgetChild?.budget_slice ?? undefined,
      usage: childUsage ?? EmptyWorkflowBudgetUsage,
      elapsedMs: budgetChild ? now - (budgetChild.time_started ?? budgetChild.time_created) : undefined,
    })
    const budgetWarnings = [...workflowEvaluation.warnings, ...childEvaluation.warnings]
    const budgetExceededMessages = [...workflowEvaluation.exceeded, ...childEvaluation.exceeded]
    const budgetExceeded = budgetExceededMessages.length > 0
    const stopMessage = budgetExceeded ? `Workflow budget exceeded: ${budgetExceededMessages.join("; ")}` : undefined
    const row = db
      .insert(WorkflowBudgetLedgerTable)
      .values({
        id: WorkflowBudgetLedgerID.ascending(),
        run_id: parsed.runID,
        phase_id: parsed.phaseID,
        child_id: parsed.childID,
        kind: parsed.kind,
        usage_delta: parsed.usageDelta,
        message: parsed.message,
        time_created: now,
        time_updated: now,
      })
      .returning()
      .get()

    let exceededEntry: WorkflowBudgetLedgerEntry | undefined
    let failedRun: WorkflowRunState.Info | undefined
    let failedPhase: WorkflowPhaseRecord | undefined
    let failedPhasePreviousStatus: WorkflowRunState.PhaseStatus | undefined
    let failedChild: WorkflowChildRecord | undefined
    let failedChildPreviousStatus: WorkflowRunState.ChildStatus | undefined

    if (budgetExceeded && stopMessage && !isTerminalRunStatus(run.status)) {
      if (parsed.kind !== "exceeded") {
        const exceededRow = db
          .insert(WorkflowBudgetLedgerTable)
          .values({
            id: WorkflowBudgetLedgerID.ascending(),
            run_id: parsed.runID,
            phase_id: parsed.phaseID,
            child_id: parsed.childID,
            kind: "exceeded",
            usage_delta: EmptyWorkflowBudgetUsage,
            message: stopMessage,
            time_created: now,
            time_updated: now,
          })
          .returning()
          .get()
        exceededEntry = fromBudgetLedgerRow(exceededRow)
      }

      if (parsed.childID) {
        if (budgetChild && !isTerminalChildStatus(budgetChild.status)) {
          failedChildPreviousStatus = budgetChild.status
          const failedChildRow = db
            .update(WorkflowChildTable)
            .set({
              status: "failed",
              error: stopMessage,
              time_completed: now,
              time_updated: now,
            })
            .where(eq(WorkflowChildTable.id, parsed.childID))
            .returning()
            .get()
          if (failedChildRow) failedChild = fromChildRow(failedChildRow)
        }
      }

      if (parsed.phaseID) {
        const phase = db.select().from(WorkflowPhaseTable).where(eq(WorkflowPhaseTable.id, parsed.phaseID)).get()
        if (phase && !isTerminalPhaseStatus(phase.status)) {
          failedPhasePreviousStatus = phase.status
          const failedPhaseRow = db
            .update(WorkflowPhaseTable)
            .set({
              status: "failed",
              error: stopMessage,
              time_completed: now,
              time_updated: now,
            })
            .where(eq(WorkflowPhaseTable.id, parsed.phaseID))
            .returning()
            .get()
          if (failedPhaseRow) failedPhase = fromPhaseRow(failedPhaseRow)
        }
      }

      const failedRunRow = db
        .update(WorkflowRunTable)
        .set({
          status: "failed",
          error: stopMessage,
          budget_usage: nextUsage,
          time_completed: now,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, parsed.runID))
        .returning()
        .get()
      if (failedRunRow) failedRun = fromRunRow(failedRunRow)
    } else {
      db.update(WorkflowRunTable)
        .set({
          budget_usage: nextUsage,
          time_updated: now,
        })
        .where(eq(WorkflowRunTable.id, parsed.runID))
        .run()
    }

    return {
      entry: fromBudgetLedgerRow(row),
      exceededEntry,
      failedRun,
      failedRunPreviousStatus: run.status,
      failedPhase,
      failedPhasePreviousStatus,
      failedChild,
      failedChildPreviousStatus,
      warnings: budgetWarnings,
      exceeded: budgetExceededMessages,
    }
  })
  publishBudgetAppended(changed.entry)
  if (changed.warnings.length > 0) publishBudgetWarning(changed.entry, changed.warnings)
  if (changed.exceededEntry) publishBudgetAppended(changed.exceededEntry)
  if (changed.exceeded.length > 0) {
    publishBudgetExceeded(changed.exceededEntry ?? changed.entry, changed.exceeded)
  }
  if (changed.failedChild) publishChildUpdated(changed.failedChild, changed.failedChildPreviousStatus)
  if (changed.failedPhase) publishPhaseUpdated(changed.failedPhase, changed.failedPhasePreviousStatus)
  if (changed.failedRun) publishUpdated(changed.failedRun, changed.failedRunPreviousStatus)
  return changed.entry
}
