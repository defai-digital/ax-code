import { describe, expect, test, vi } from "vitest"

// AX_CODE_SHARD_SESSIONS is an import-time const in the Flag namespace, and the
// vitest setup chain already loads flag.ts before test files run, so setting
// process.env here is too late. Mock the Flag module instead: preserve every
// other flag and force the sharding flag ON for this file only (vitest isolates
// module state per test file under the forks pool).
vi.mock("../../src/flag/flag", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/flag/flag")>()
  return {
    ...mod,
    Flag: {
      ...mod.Flag,
      AX_CODE_SHARD_SESSIONS: true,
    },
  }
})

import { Session } from "../../src/session/index"
import { SessionShard } from "../../src/session/shard"
import { Instance } from "../../src/project/instance"
import { Shard } from "../../src/storage/shard"
import { Database, eq } from "../../src/storage/db"
import {
  MessageTable,
  TodoTable,
  SessionGoalTable,
  TaskQueueTable,
  ScheduledTaskTable,
} from "../../src/session/session.sql"
import {
  WorkflowRunTable,
  WorkflowPhaseTable,
  WorkflowChildTable,
  WorkflowArtifactTable,
  WorkflowBudgetLedgerTable,
} from "../../src/workflow/workflow.sql"
import { ProjectShardTable } from "../../src/storage/shard.sql"
import { MessageID, TaskQueueID, ScheduledTaskID } from "../../src/session/schema"
import {
  WorkflowRunID,
  WorkflowPhaseID,
  WorkflowChildID,
  WorkflowArtifactID,
  WorkflowBudgetLedgerID,
} from "../../src/workflow/state"
import { tmpdir } from "../fixture/fixture"

// A minimal valid user message (matches test/session/usage.test.ts).
function userMessage(id: string, sessionID: string) {
  return {
    id,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  } as unknown as Parameters<typeof Session.updateMessage>[0]
}

// Insert a message directly into the GLOBAL db, bypassing shard routing — used
// to seed pre-backfill global rows (the lazy copy source).
function insertGlobalMessage(id: string, sessionID: string) {
  const msg = userMessage(id, sessionID)
  const { id: _id, sessionID: _sid, ...data } = msg
  Database.use((db) =>
    db
      .insert(MessageTable)
      .values({ id, session_id: sessionID, time_created: msg.time.created, data } as never)
      .run(),
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardState(projectID: any) {
  return Database.use((db) =>
    db
      .select({ state: ProjectShardTable.state })
      .from(ProjectShardTable)
      .where(eq(ProjectShardTable.project_id, projectID))
      .get(),
  )?.state
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardMessageCount(projectID: any, sessionID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(MessageTable).where(eq(MessageTable.session_id, sessionID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function globalMessageCount(sessionID: any) {
  return Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.session_id, sessionID)).all()).length
}

// Insert a todo row directly into the GLOBAL db, bypassing shard routing — used
// to seed pre-backfill global rows (the lazy copy source). The global `todo`
// DDL has no defaults for either timestamp column, so both are provided.
function insertGlobalTodo(sessionID: string, position: number, content = "seed todo") {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(TodoTable)
      .values({
        session_id: sessionID,
        content,
        status: "pending",
        priority: "medium",
        position,
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

// Insert a session_goal row directly into the GLOBAL db, bypassing shard routing.
function insertGlobalGoal(sessionID: string, objective = "seed goal") {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(SessionGoalTable)
      .values({
        session_id: sessionID,
        objective,
        status: "active",
        token_budget: 1000,
        tokens_used: 0,
        time_used_seconds: 0,
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardTodoCount(projectID: any, sessionID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardGoalCount(projectID: any, sessionID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, sessionID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function globalTodoCount(sessionID: any) {
  return Database.use((db) => db.select().from(TodoTable).where(eq(TodoTable.session_id, sessionID)).all()).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function globalGoalCount(sessionID: any) {
  return Database.use((db) =>
    db.select().from(SessionGoalTable).where(eq(SessionGoalTable.session_id, sessionID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardVersion(projectID: any) {
  return Database.use((db) =>
    db
      .select({ version: ProjectShardTable.backfill_version })
      .from(ProjectShardTable)
      .where(eq(ProjectShardTable.project_id, projectID))
      .get(),
  )?.version
}

// --- Slice 4 seed helpers (bypass shard routing; write directly to GLOBAL) ---

function insertGlobalTaskQueue(id: string, projectID: string, position: number) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(TaskQueueTable)
      .values({
        id,
        project_id: projectID,
        directory: ".",
        kind: "prompt",
        status: "queued",
        priority: 0,
        position,
        title: "seed task",
        payload: {},
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalScheduledTask(id: string, projectID: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(ScheduledTaskTable)
      .values({
        id,
        project_id: projectID,
        directory: ".",
        title: "seed scheduled",
        prompt: "seed prompt",
        schedule: { type: "once", runAt: now + 60_000 },
        status: "active",
        catch_up_policy: "run_once",
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalWorkflowRun(id: string, projectID: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkflowRunTable)
      .values({
        id,
        project_id: projectID,
        directory: ".",
        status: "queued",
        spec_snapshot: {},
        input_values: {},
        budget: {},
        budget_usage: {},
        verification_envelope_ids: [],
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalWorkflowPhase(id: string, runID: string, position: number) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkflowPhaseTable)
      .values({
        id,
        run_id: runID,
        spec_phase_id: "seed-phase",
        position,
        name: "Seed phase",
        kind: "prompt",
        status: "queued",
        outputs: [],
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalWorkflowChild(id: string, runID: string, phaseID: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkflowChildTable)
      .values({
        id,
        run_id: runID,
        phase_id: phaseID,
        status: "queued",
        artifact_ids: [],
        evidence_refs: [],
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalWorkflowArtifact(id: string, runID: string, phaseID?: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkflowArtifactTable)
      .values({
        id,
        run_id: runID,
        phase_id: phaseID ?? null,
        kind: "summary",
        retention: "session",
        expose_to_main_context: false,
        evidence_refs: [],
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalWorkflowBudgetLedger(id: string, runID: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(WorkflowBudgetLedgerTable)
      .values({
        id,
        run_id: runID,
        kind: "usage",
        usage_delta: {},
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

// --- Slice 4 shard-count helpers (read the shard directly) ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardTaskQueueCount(projectID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(TaskQueueTable).where(eq(TaskQueueTable.project_id, projectID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardScheduledTaskCount(projectID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(ScheduledTaskTable).where(eq(ScheduledTaskTable.project_id, projectID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardWorkflowRunCount(projectID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.project_id, projectID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardWorkflowPhaseCount(projectID: any, runID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(WorkflowPhaseTable).where(eq(WorkflowPhaseTable.run_id, runID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardWorkflowChildCount(projectID: any, runID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(WorkflowChildTable).where(eq(WorkflowChildTable.run_id, runID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardWorkflowArtifactCount(projectID: any, runID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(WorkflowArtifactTable).where(eq(WorkflowArtifactTable.run_id, runID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardWorkflowBudgetLedgerCount(projectID: any, runID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(WorkflowBudgetLedgerTable).where(eq(WorkflowBudgetLedgerTable.run_id, runID)).all(),
  ).length
}

describe("AX_CODE_SHARD_SESSIONS=1", () => {
  test("updateMessage routes to the shard, not the global db", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))

        const projectID = Instance.project.id
        expect(shardMessageCount(projectID, session.id)).toBe(1)
        expect(globalMessageCount(session.id)).toBe(0)
      },
    })
  })

  test("reads fall back to the global db while state is not active", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id

        // Seed a global row WITHOUT triggering a shard write (no backfill yet).
        insertGlobalMessage(MessageID.ascending(), session.id)
        expect(shardState(projectID)).toBeUndefined()

        // Read falls back to global (state != active).
        const msgs = await Session.messages({ sessionID: session.id })
        expect(msgs).toHaveLength(1)
        // No shard was written, so state stays unset.
        expect(shardState(projectID)).toBeUndefined()
      },
    })
  })

  test("first shard write backfills existing global rows idempotently", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id

        insertGlobalMessage(MessageID.ascending(), session.id)
        insertGlobalMessage(MessageID.ascending(), session.id)
        expect(globalMessageCount(session.id)).toBe(2)

        // First write triggers the lazy copy + the new write.
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))

        expect(shardState(projectID)).toBe("active")
        // 2 backfilled + 1 new, no duplicates.
        expect(shardMessageCount(projectID, session.id)).toBe(3)
      },
    })
  })

  test("recovering from a 'backfilling' crash re-runs the idempotent copy", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id

        insertGlobalMessage(MessageID.ascending(), session.id)

        // Simulate a crash mid-backfill: state left at "backfilling".
        Database.use((db) =>
          db
            .insert(ProjectShardTable)
            .values({
              project_id: projectID,
              shard_file: Shard.pathFor(projectID),
              state: "backfilling",
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )
        expect(shardState(projectID)).toBe("backfilling")

        // The next write re-runs the copy (idempotent) and flips to active.
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))
        expect(shardState(projectID)).toBe("active")
        expect(shardMessageCount(projectID, session.id)).toBe(2)
      },
    })
  })

  test("backfill copies todo + session_goal rows into the shard", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id

        insertGlobalTodo(session.id, 0)
        insertGlobalGoal(session.id)
        expect(globalTodoCount(session.id)).toBe(1)
        expect(globalGoalCount(session.id)).toBe(1)

        // First write triggers the lazy copy of every sharded table.
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))

        expect(shardState(projectID)).toBe("active")
        expect(shardVersion(projectID)).toBe(SessionShard.BACKFILL_VERSION)
        expect(shardTodoCount(projectID, session.id)).toBe(1)
        expect(shardGoalCount(projectID, session.id)).toBe(1)
      },
    })
  })

  test("a stale backfill_version re-runs the copy and ends version-current", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id

        insertGlobalTodo(session.id, 0)
        insertGlobalGoal(session.id)

        // Simulate a shard that was backfilled under an earlier slice: state is
        // "active" but the coverage version is stale, so the todo/session_goal
        // tables added by slice 3 are missing from the shard.
        Database.use((db) =>
          db
            .insert(ProjectShardTable)
            .values({
              project_id: projectID,
              shard_file: Shard.pathFor(projectID),
              state: "active",
              backfill_version: SessionShard.BACKFILL_VERSION - 1,
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )
        expect(shardVersion(projectID)).toBe(SessionShard.BACKFILL_VERSION - 1)

        // The next write re-runs the (idempotent) copy and stamps the version.
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))

        expect(shardState(projectID)).toBe("active")
        expect(shardVersion(projectID)).toBe(SessionShard.BACKFILL_VERSION)
        expect(shardTodoCount(projectID, session.id)).toBe(1)
        expect(shardGoalCount(projectID, session.id)).toBe(1)
      },
    })
  })

  test("backfill copies task_queue + scheduled_task + workflow_* rows into the shard", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id
        const runID = WorkflowRunID.ascending()
        const phaseID = WorkflowPhaseID.ascending()

        insertGlobalTaskQueue(TaskQueueID.ascending(), projectID, 0)
        insertGlobalScheduledTask(ScheduledTaskID.ascending(), projectID)
        insertGlobalWorkflowRun(runID, projectID)
        insertGlobalWorkflowPhase(phaseID, runID, 0)
        insertGlobalWorkflowChild(WorkflowChildID.ascending(), runID, phaseID)
        insertGlobalWorkflowArtifact(WorkflowArtifactID.ascending(), runID, phaseID)
        insertGlobalWorkflowBudgetLedger(WorkflowBudgetLedgerID.ascending(), runID)

        // First write triggers the lazy copy of every sharded table.
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))

        expect(shardState(projectID)).toBe("active")
        expect(shardVersion(projectID)).toBe(SessionShard.BACKFILL_VERSION)
        expect(shardTaskQueueCount(projectID)).toBe(1)
        expect(shardScheduledTaskCount(projectID)).toBe(1)
        expect(shardWorkflowRunCount(projectID)).toBe(1)
        expect(shardWorkflowPhaseCount(projectID, runID)).toBe(1)
        expect(shardWorkflowChildCount(projectID, runID)).toBe(1)
        expect(shardWorkflowArtifactCount(projectID, runID)).toBe(1)
        expect(shardWorkflowBudgetLedgerCount(projectID, runID)).toBe(1)
      },
    })
  })

  test("a stale version-3 shard re-runs and copies slice-4 tables, ending version-current", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id
        const runID = WorkflowRunID.ascending()
        const phaseID = WorkflowPhaseID.ascending()

        insertGlobalTaskQueue(TaskQueueID.ascending(), projectID, 0)
        insertGlobalScheduledTask(ScheduledTaskID.ascending(), projectID)
        insertGlobalWorkflowRun(runID, projectID)
        insertGlobalWorkflowPhase(phaseID, runID, 0)
        insertGlobalWorkflowChild(WorkflowChildID.ascending(), runID, phaseID)
        insertGlobalWorkflowArtifact(WorkflowArtifactID.ascending(), runID, phaseID)
        insertGlobalWorkflowBudgetLedger(WorkflowBudgetLedgerID.ascending(), runID)

        // Simulate a shard backfilled under slice 3 (task_queue/scheduled_task/
        // workflow_* not yet sharded): active but version 3.
        Database.use((db) =>
          db
            .insert(ProjectShardTable)
            .values({
              project_id: projectID,
              shard_file: Shard.pathFor(projectID),
              state: "active",
              backfill_version: 3,
              time_created: Date.now(),
              time_updated: Date.now(),
            })
            .run(),
        )
        expect(shardVersion(projectID)).toBe(3)

        // The next write re-runs the (idempotent) copy and stamps the version.
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))

        expect(shardState(projectID)).toBe("active")
        expect(shardVersion(projectID)).toBe(SessionShard.BACKFILL_VERSION)
        expect(shardTaskQueueCount(projectID)).toBe(1)
        expect(shardScheduledTaskCount(projectID)).toBe(1)
        expect(shardWorkflowRunCount(projectID)).toBe(1)
        expect(shardWorkflowPhaseCount(projectID, runID)).toBe(1)
        expect(shardWorkflowChildCount(projectID, runID)).toBe(1)
        expect(shardWorkflowArtifactCount(projectID, runID)).toBe(1)
        expect(shardWorkflowBudgetLedgerCount(projectID, runID)).toBe(1)
      },
    })
  })
})
