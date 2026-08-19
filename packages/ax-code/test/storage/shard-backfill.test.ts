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
import { Instance } from "../../src/project/instance"
import { Shard } from "../../src/storage/shard"
import { Database, eq } from "../../src/storage/db"
import { MessageTable } from "../../src/session/session.sql"
import { ProjectShardTable } from "../../src/storage/shard.sql"
import { MessageID } from "../../src/session/schema"
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
})
