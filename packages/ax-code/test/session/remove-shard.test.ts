import { describe, expect, test, vi } from "vitest"

// AX_CODE_SHARD_SESSIONS is an import-time const in the Flag namespace; force
// it ON for this file only (same pattern as test/storage/shard-backfill.test.ts).
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
import { Project } from "../../src/project/project"
import { ProjectTable } from "../../src/project/project.sql"
import { Shard } from "../../src/storage/shard"
import { Database, eq } from "../../src/storage/db"
import { MessageTable, TodoTable, SessionGoalTable, TaskQueueTable, SessionTable } from "../../src/session/session.sql"
import { EventLogTable } from "../../src/replay/event-log.sql"
import { WorkflowRunTable, WorkflowPhaseTable, WorkflowChildTable } from "../../src/workflow/workflow.sql"
import { ProjectShardTable } from "../../src/storage/shard.sql"
import { MessageID, TaskQueueID } from "../../src/session/schema"
import { WorkflowRunID, WorkflowPhaseID, WorkflowChildID } from "../../src/workflow/state"
import { existsSync } from "node:fs"
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

// --- Seed helpers: insert rows directly into the GLOBAL db, bypassing shard
// routing. These are the lazy-backfill source rows; the first shard write copies
// them into the shard. ---

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

function insertGlobalTodo(sessionID: string, position: number) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(TodoTable)
      .values({
        session_id: sessionID,
        content: "seed todo",
        status: "pending",
        priority: "medium",
        position,
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalGoal(sessionID: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(SessionGoalTable)
      .values({
        session_id: sessionID,
        objective: "seed goal",
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

function insertGlobalEvent(id: string, sessionID: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EventLogTable)
      .values({
        id,
        session_id: sessionID,
        step_id: null,
        event_type: "agent.route",
        event_data: {},
        sequence: 0,
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

function insertGlobalTaskQueue(id: string, projectID: string, sessionID: string) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(TaskQueueTable)
      .values({
        id,
        project_id: projectID,
        session_id: sessionID,
        directory: ".",
        kind: "prompt",
        status: "queued",
        priority: 0,
        position: 0,
        title: "seed task",
        payload: {},
        time_created: now,
        time_updated: now,
      } as never)
      .run(),
  )
}

// Seed a workflow_run (referencing the session via parent_session_id) plus its
// phase and child (referencing the session via workflow_child.session_id). The
// registry DDL uses `onDelete: "set null"` for both session references, so
// Session.remove must null (not delete) them in the shard.
function insertGlobalWorkflow(projectID: string, sessionID: string) {
  const now = Date.now()
  const runID = WorkflowRunID.ascending()
  const phaseID = WorkflowPhaseID.ascending()
  const childID = WorkflowChildID.ascending()
  Database.use((db) => {
    db.insert(WorkflowRunTable)
      .values({
        id: runID,
        project_id: projectID,
        parent_session_id: sessionID,
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
      .run()
    db.insert(WorkflowPhaseTable)
      .values({
        id: phaseID,
        run_id: runID,
        spec_phase_id: "seed-phase",
        position: 0,
        name: "seed",
        kind: "prompt",
        status: "queued",
        outputs: [],
        time_created: now,
        time_updated: now,
      } as never)
      .run()
    db.insert(WorkflowChildTable)
      .values({
        id: childID,
        run_id: runID,
        phase_id: phaseID,
        session_id: sessionID,
        status: "queued",
        artifact_ids: [],
        evidence_refs: [],
        time_created: now,
        time_updated: now,
      } as never)
      .run()
  })
  return { runID, childID }
}

// --- Shard / registry count helpers. ---

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardMessageCount(projectID: any, sessionID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(MessageTable).where(eq(MessageTable.session_id, sessionID)).all(),
  ).length
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
function shardEventCount(projectID: any, sessionID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(EventLogTable).where(eq(EventLogTable.session_id, sessionID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardTaskQueueCount(projectID: any, sessionID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(TaskQueueTable).where(eq(TaskQueueTable.session_id, sessionID)).all(),
  ).length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function registrySessionCount(projectID: any) {
  return Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.project_id, projectID)).all()).length
}

describe("AX_CODE_SHARD_SESSIONS=1 lifecycle cleanup", () => {
  test("Session.remove cascades session-scoped shard rows", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id

        insertGlobalMessage(MessageID.ascending(), session.id)
        insertGlobalTodo(session.id, 0)
        insertGlobalGoal(session.id)
        insertGlobalEvent("event-1", session.id)
        insertGlobalTaskQueue(TaskQueueID.ascending(), projectID, session.id)
        const { runID, childID } = insertGlobalWorkflow(projectID, session.id)

        // First write triggers the lazy backfill of every sharded table.
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))

        expect(shardMessageCount(projectID, session.id)).toBe(2)
        expect(shardTodoCount(projectID, session.id)).toBe(1)
        expect(shardGoalCount(projectID, session.id)).toBe(1)
        expect(shardEventCount(projectID, session.id)).toBe(1)
        expect(shardTaskQueueCount(projectID, session.id)).toBe(1)

        await Session.remove(session.id)

        expect(shardMessageCount(projectID, session.id)).toBe(0)
        expect(shardTodoCount(projectID, session.id)).toBe(0)
        expect(shardGoalCount(projectID, session.id)).toBe(0)
        expect(shardEventCount(projectID, session.id)).toBe(0)
        expect(shardTaskQueueCount(projectID, session.id)).toBe(0)
        expect(registrySessionCount(projectID)).toBe(0)
        // Workflow references are nulled (registry `onDelete: "set null"`), NOT
        // deleted: the run/child rows survive with a null session reference.
        const run = Shard.handle(projectID).use((db) =>
          db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, runID)).get(),
        )
        expect(run).toBeDefined()
        expect(run?.parent_session_id).toBeNull()
        const child = Shard.handle(projectID).use((db) =>
          db.select().from(WorkflowChildTable).where(eq(WorkflowChildTable.id, childID)).get(),
        )
        expect(child).toBeDefined()
        expect(child?.session_id).toBeNull()
      },
    })
  })

  test("fork failure compensating delete leaves no orphaned child shard rows", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))
        const projectID = Instance.project.id
        expect(shardMessageCount(projectID, session.id)).toBe(1)

        // Force the fork's child shard write to fail: storeFor returns a store
        // whose transaction throws. Session.fork's catch block must then run the
        // compensating delete (SessionShard.deleteSessions) for the child's
        // project and drop the child's registry row.
        const real = SessionShard.storeFor.bind(SessionShard)
        const spy = vi.spyOn(SessionShard, "storeFor").mockImplementation(((sid: any, opts: any) => {
          if (opts?.write) {
            return {
              use: (cb: any) => real(sid, opts).use(cb),
              transaction: () => {
                throw new Error("injected fork failure")
              },
              effect: () => {},
            }
          }
          return real(sid, opts)
        }) as any)

        await expect(Session.fork({ sessionID: session.id })).rejects.toThrow()

        spy.mockRestore()

        // Parent shard rows are intact; the child registry row was cleaned up.
        expect(shardMessageCount(projectID, session.id)).toBe(1)
        expect(registrySessionCount(projectID)).toBe(1)
      },
    })
  })

  test("sweepOrphans removes dangling rows and keeps live ones", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const projectID = Instance.project.id
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))
        expect(shardMessageCount(projectID, session.id)).toBe(1)

        // Insert a "ghost" message directly into the shard for a session that
        // does not exist in the registry (simulates a crashed Session.remove).
        const ghostID = "ghost-session-1"
        const msg = userMessage(MessageID.ascending(), ghostID)
        const { id, sessionID, ...data } = msg
        Shard.handle(projectID).use((db) =>
          db
            .insert(MessageTable)
            .values({ id, session_id: sessionID, time_created: msg.time.created, data } as never)
            .run(),
        )
        expect(shardMessageCount(projectID, ghostID)).toBe(1)

        SessionShard.sweepOrphans(projectID)

        expect(shardMessageCount(projectID, ghostID)).toBe(0)
        expect(shardMessageCount(projectID, session.id)).toBe(1)
      },
    })
  })

  test("Project.remove deletes the registry project, project_shard row, and shard file", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Session.updateMessage(userMessage(MessageID.ascending(), session.id))
        const projectID = Instance.project.id
        const shardFile = Shard.pathFor(projectID)

        // Sanity: shard file + project_shard row exist after backfill.
        expect(existsSync(shardFile)).toBe(true)
        expect(
          Database.use((db) =>
            db.select().from(ProjectShardTable).where(eq(ProjectShardTable.project_id, projectID)).get(),
          ),
        ).toBeDefined()

        await Project.remove(projectID)

        expect(
          Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, projectID)).get()),
        ).toBeUndefined()
        expect(
          Database.use((db) =>
            db.select().from(ProjectShardTable).where(eq(ProjectShardTable.project_id, projectID)).get(),
          ),
        ).toBeUndefined()
        expect(existsSync(shardFile)).toBe(false)
      },
    })
  })
})
