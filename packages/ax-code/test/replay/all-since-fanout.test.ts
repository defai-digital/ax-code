import { afterEach, describe, expect, test, vi } from "vitest"

// AX_CODE_SHARD_SESSIONS is an import-time const in the Flag namespace (same
// caveat as test/storage/shard-backfill.test.ts), so mock the Flag module to
// force sharding ON for this file only.
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

import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session/index"
import { EventQuery } from "../../src/replay/query"
import { SessionShard } from "../../src/session/shard"
import { Shard } from "../../src/storage/shard"
import { Database, eq } from "../../src/storage/db"
import { EventLogTable } from "../../src/replay/event-log.sql"
import { EventLogID } from "../../src/replay/index"
import { ProjectShardTable } from "../../src/storage/shard.sql"
import type { SessionID } from "../../src/session/schema"
import type { ProjectID } from "../../src/project/schema"
import { tmpdir } from "../fixture/fixture"

// The registry DB and shard files are shared across tests within a file (only
// XDG_DATA_HOME is per-file), and allSince fans out to every active shard — so
// wipe project_shard + global events between tests to keep each fan-out scoped
// to its own project's shards.
afterEach(() => {
  Shard.closeAll()
  Database.use((db) => {
    db.delete(EventLogTable).run()
    db.delete(ProjectShardTable).run()
  })
})

// Build a raw event row with an explicit time so the fan-out ordering is
// deterministic (the recorder's Date.now() would make interleaving flaky).
function evt(marker: string, sessionID: SessionID, sequence: number, time: number) {
  return {
    id: EventLogID.ascending(),
    session_id: sessionID,
    step_id: null,
    event_type: "step.start",
    event_data: { type: "step.start", sessionID, stepIndex: sequence, marker } as never,
    sequence,
    time_created: time,
    time_updated: time,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function insertGlobal(row: any) {
  Database.use((db) => db.insert(EventLogTable).values(row).run())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function insertShard(projectID: any, row: any) {
  Shard.handle(projectID).use((db) => db.insert(EventLogTable).values(row).run())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function globalEventCount(sessionID: any) {
  return Database.use((db) => db.select().from(EventLogTable).where(eq(EventLogTable.session_id, sessionID)).all())
    .length
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper
function shardEventCount(projectID: any, sessionID: any) {
  return Shard.handle(projectID).use((db) =>
    db.select().from(EventLogTable).where(eq(EventLogTable.session_id, sessionID)).all(),
  ).length
}

// Page through allSince with `limit` rows per call (mirrors AuditExport.streamAll)
// and return the markers in visit order, to prove cursor pagination is gapless.
function drainMarkers(since: number, limit: number): string[] {
  const markers: string[] = []
  let cursor: { time_created: number; session_id: SessionID; sequence: number } | undefined
  while (true) {
    const rows = EventQuery.allSince({ since, limit, cursor })
    if (rows.length === 0) break
    for (const row of rows) markers.push((row.event_data as any).marker)
    cursor = rows[rows.length - 1]
  }
  return markers
}

describe("EventQuery.allSince fan-out (AX_CODE_SHARD_SESSIONS=1)", () => {
  test("merges interleaved events from two shards in composite order and respects limit", async () => {
    await using a = await tmpdir({ git: true })
    await using b = await tmpdir({ git: true })

    let projectA!: ProjectID
    let projectB!: ProjectID
    let sessionA!: SessionID
    let sessionB!: SessionID

    await Instance.provide({
      directory: a.path,
      fn: async () => {
        projectA = Instance.project.id
        sessionA = (await Session.create({})).id
      },
    })
    await Instance.provide({
      directory: b.path,
      fn: async () => {
        projectB = Instance.project.id
        sessionB = (await Session.create({})).id
      },
    })

    // Activate both shards (no events yet) so the fan-out reads from them.
    SessionShard.storeForProject(projectA, { write: true })
    SessionShard.storeForProject(projectB, { write: true })

    // Interleave events across the two shards by explicit time_created.
    insertShard(projectA, evt("a0", sessionA, 0, 1000))
    insertShard(projectB, evt("b0", sessionB, 0, 2000))
    insertShard(projectA, evt("a1", sessionA, 1, 3000))
    insertShard(projectB, evt("b1", sessionB, 1, 4000))
    insertShard(projectA, evt("a2", sessionA, 2, 5000))

    const rows = EventQuery.allSince({ since: 0 })
    expect(rows.map((r) => (r.event_data as any).marker)).toEqual(["a0", "b0", "a1", "b1", "a2"])

    // Limit is applied to the merged stream, not per source.
    const limited = EventQuery.allSince({ since: 0, limit: 3 })
    expect(limited.map((r) => (r.event_data as any).marker)).toEqual(["a0", "b0", "a1"])
  })

  test("cursor pagination is gapless across shards", async () => {
    await using a = await tmpdir({ git: true })
    await using b = await tmpdir({ git: true })

    let projectA!: ProjectID
    let projectB!: ProjectID
    let sessionA!: SessionID
    let sessionB!: SessionID

    await Instance.provide({
      directory: a.path,
      fn: async () => {
        projectA = Instance.project.id
        sessionA = (await Session.create({})).id
      },
    })
    await Instance.provide({
      directory: b.path,
      fn: async () => {
        projectB = Instance.project.id
        sessionB = (await Session.create({})).id
      },
    })

    SessionShard.storeForProject(projectA, { write: true })
    SessionShard.storeForProject(projectB, { write: true })

    insertShard(projectA, evt("a0", sessionA, 0, 1000))
    insertShard(projectB, evt("b0", sessionB, 0, 2000))
    insertShard(projectA, evt("a1", sessionA, 1, 3000))
    insertShard(projectB, evt("b1", sessionB, 1, 4000))
    insertShard(projectA, evt("a2", sessionA, 2, 5000))

    // Paginate 2 at a time; the merged composite cursor must produce the full
    // stream in order with no gaps or repeats.
    expect(drainMarkers(0, 2)).toEqual(["a0", "b0", "a1", "b1", "a2"])
  })

  test("dedupes rows that exist in both the global table and a shard after backfill", async () => {
    await using a = await tmpdir({ git: true })

    let projectA!: ProjectID
    let sessionA!: SessionID

    await Instance.provide({
      directory: a.path,
      fn: async () => {
        projectA = Instance.project.id
        sessionA = (await Session.create({})).id
      },
    })

    // Seed global rows BEFORE the shard is backfilled; the copy then lands in
    // both the global table and the shard.
    insertGlobal(evt("g0", sessionA, 0, 100))
    insertGlobal(evt("g1", sessionA, 1, 200))
    expect(globalEventCount(sessionA)).toBe(2)

    // Activating the shard triggers the lazy backfill (global → shard copy).
    SessionShard.storeForProject(projectA, { write: true })
    expect(shardEventCount(projectA, sessionA)).toBe(2)

    // The fan-out reads both stores and must collapse the duplicates.
    const rows = EventQuery.allSince({ since: 0 })
    expect(rows.map((r) => (r.event_data as any).marker)).toEqual(["g0", "g1"])
    const keys = rows.map((r) => `${r.time_created}|${r.session_id}|${r.sequence}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  test("EventQuery.insert routes new events to the shard, not the global table", async () => {
    await using a = await tmpdir({ git: true })

    let projectA!: ProjectID
    let sessionA!: SessionID

    await Instance.provide({
      directory: a.path,
      fn: async () => {
        projectA = Instance.project.id
        sessionA = (await Session.create({})).id
      },
    })

    EventQuery.insert({
      id: EventLogID.ascending(),
      session_id: sessionA,
      step_id: null,
      event_type: "step.start",
      event_data: { type: "step.start", sessionID: sessionA, stepIndex: 0 } as never,
      sequence: 0,
    })

    expect(shardEventCount(projectA, sessionA)).toBe(1)
    expect(globalEventCount(sessionA)).toBe(0)
  })
})
