import { Database, eq, and, or, gt, gte, lte, desc, sql } from "../storage/db"
import { EventLogTable } from "./event-log.sql"
import { EventLogID } from "./index"
import type { ReplayEvent } from "./event"
import { SessionID } from "../session/schema"
import { Log } from "../util/log"
import { NamedError } from "@ax-code/util/error"
import z from "zod"
import { Flag } from "../flag/flag"
import { Shard } from "../storage/shard"
import { SessionShard } from "../session/shard"
import type { ProjectID } from "../project/schema"

export namespace EventQuery {
  const log = Log.create({ service: "replay.query" })

  export const ALL_SINCE_LIMIT = 500
  // Per-session full-log loads are capped to bound peak memory for
  // pathologically long sessions. tool.result events can each carry
  // megabytes of stdout, so an unbounded `.all()` over a 5k-event log
  // can hold hundreds of MB resident. 10k matches the largest session
  // size we've seen in practice; callers that genuinely need unbounded
  // reads should paginate via `allSince`.
  export const BY_SESSION_LIMIT = 10_000

  // Thrown when a strict per-session loader detects truncation. Replay
  // determinism-critical paths (Replay.compare, reconstructStream) use
  // assertNotTruncated so they fail loudly instead of silently producing
  // wrong results. Diagnostic paths (audit, telemetry, trace) keep using
  // warnIfTruncated which logs but tolerates the partial slice.
  export const TruncatedError = NamedError.create(
    "ReplayTruncatedError",
    z.object({
      sessionID: z.string(),
      returned: z.number(),
      total: z.number(),
      limit: z.number(),
    }),
  )

  function warnIfTruncated(sessionID: SessionID, returned: number) {
    if (returned < BY_SESSION_LIMIT) return
    const total = count(sessionID)
    if (total <= BY_SESSION_LIMIT) return
    log.warn("session event log truncated by BY_SESSION_LIMIT", {
      sessionID,
      returned,
      total,
      limit: BY_SESSION_LIMIT,
      hint: "Replay.compare / reconstructStream may produce incorrect results; paginate via allSince for full reads",
    })
  }

  function assertNotTruncated(sessionID: SessionID, returned: number) {
    if (returned < BY_SESSION_LIMIT) return
    const total = count(sessionID)
    if (total <= BY_SESSION_LIMIT) return
    throw new TruncatedError({
      sessionID,
      returned,
      total,
      limit: BY_SESSION_LIMIT,
    })
  }

  function normalizeRecentLimit(limit: number) {
    if (!Number.isFinite(limit)) return 0
    return Math.max(0, Math.min(Math.floor(limit), BY_SESSION_LIMIT))
  }

  export function bySession(sessionID: SessionID): ReplayEvent[] {
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(EventLogTable.sequence)
        .limit(BY_SESSION_LIMIT)
        .all(),
    )
    warnIfTruncated(sessionID, rows.length)
    return rows.map((row) => row.event_data)
  }

  /**
   * Strict variant: throws ReplayTruncatedError when the per-session
   * cap is hit and more rows exist. Use this from determinism-critical
   * paths (Replay.compare, reconstructStream) where silently returning
   * a partial slice produces wrong divergence results.
   */
  export function bySessionStrict(sessionID: SessionID): ReplayEvent[] {
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(EventLogTable.sequence)
        .limit(BY_SESSION_LIMIT)
        .all(),
    )
    assertNotTruncated(sessionID, rows.length)
    return rows.map((row) => row.event_data)
  }

  export function recentBySession(sessionID: SessionID, limit = 500): ReplayEvent[] {
    const normalizedLimit = normalizeRecentLimit(limit)
    if (normalizedLimit === 0) return []
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(desc(EventLogTable.sequence))
        .limit(normalizedLimit)
        .all(),
    )
    return rows.reverse().map((row) => row.event_data)
  }

  export function bySessionWithTimestamp(sessionID: SessionID): { event_data: ReplayEvent; time_created: number }[] {
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select({
          event_data: EventLogTable.event_data,
          time_created: EventLogTable.time_created,
        })
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(EventLogTable.sequence)
        .limit(BY_SESSION_LIMIT)
        .all(),
    )
    warnIfTruncated(sessionID, rows.length)
    return rows
  }

  /**
   * Timestamped variant filtered to a single event_type. Backed by
   * event_log_session_type_sequence_idx, so this scans only the matching
   * rows (e.g. the handful of "agent.route" events) instead of the whole
   * session log. Used by the TUI RouteIndicator, which previously loaded
   * the full log per message just to pull out agent.route rows.
   */
  export function bySessionAndTypeWithTimestamp(
    sessionID: SessionID,
    type: string,
  ): { event_data: ReplayEvent; time_created: number }[] {
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select({
          event_data: EventLogTable.event_data,
          time_created: EventLogTable.time_created,
        })
        .from(EventLogTable)
        .where(and(eq(EventLogTable.session_id, sessionID), eq(EventLogTable.event_type, type)))
        .orderBy(EventLogTable.sequence)
        .limit(BY_SESSION_LIMIT)
        .all(),
    )
    warnIfTruncated(sessionID, rows.length)
    return rows
  }

  /**
   * Returns the most recent `limit` timestamped rows in ascending sequence
   * order. Used by sidebar surfaces (e.g. the Activity list) that only ever
   * display a small window of the newest events and must not pay for a full
   * per-session load on every streamed update.
   */
  export function recentBySessionWithTimestamp(
    sessionID: SessionID,
    limit = 100,
  ): { event_data: ReplayEvent; time_created: number }[] {
    const normalizedLimit = normalizeRecentLimit(limit)
    if (normalizedLimit === 0) return []
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select({
          event_data: EventLogTable.event_data,
          time_created: EventLogTable.time_created,
        })
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(desc(EventLogTable.sequence))
        .limit(normalizedLimit)
        .all(),
    )
    return rows.reverse()
  }

  export function bySessionLog(sessionID: SessionID): {
    id: EventLogID
    step_id: string | null
    event_data: ReplayEvent
    sequence: number
    time_created: number
  }[] {
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select({
          id: EventLogTable.id,
          step_id: EventLogTable.step_id,
          event_data: EventLogTable.event_data,
          sequence: EventLogTable.sequence,
          time_created: EventLogTable.time_created,
        })
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(EventLogTable.sequence)
        .limit(BY_SESSION_LIMIT)
        .all(),
    )
    warnIfTruncated(sessionID, rows.length)
    return rows
  }

  export function bySessionAndType(sessionID: SessionID, type: string): ReplayEvent[] {
    const store = SessionShard.storeFor(sessionID)
    const rows = store.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(and(eq(EventLogTable.session_id, sessionID), eq(EventLogTable.event_type, type)))
        .orderBy(EventLogTable.sequence)
        .limit(BY_SESSION_LIMIT)
        .all(),
    )
    warnIfTruncated(sessionID, rows.length)
    return rows.map((row) => row.event_data)
  }

  export function count(sessionID: SessionID): number {
    // Use COUNT(*) via .get() instead of loading every row to count
    // them. See code-intelligence/query.ts countNodes for rationale.
    const store = SessionShard.storeFor(sessionID)
    const row = store.use((db) =>
      db
        .select({ count: sql<number>`count(*)` })
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .get(),
    )
    return row?.count ?? 0
  }

  export type AllSinceRow = {
    session_id: SessionID
    event_data: ReplayEvent
    time_created: number
    sequence: number
  }

  // Composite ordering key shared by allSince (both the SQL ORDER BY and the
  // in-memory fan-out merge). (time_created, session_id, sequence) is a total
  // order: sequence is unique per session, session_id is globally unique, and
  // time_created is a tiebreaker that is stable for a single event.
  function compareAllSince(a: AllSinceRow, b: AllSinceRow): number {
    if (a.time_created !== b.time_created) return a.time_created - b.time_created
    if (a.session_id !== b.session_id) return (a.session_id as string) < (b.session_id as string) ? -1 : 1
    return a.sequence - b.sequence
  }

  export function allSince(input: {
    since: number
    limit?: number
    cursor?: {
      time_created: number
      session_id: SessionID
      sequence: number
    }
  }): AllSinceRow[] {
    const parsed = z
      .object({
        since: z.number().int().min(0),
        limit: z.number().int().positive().optional(),
        cursor: z
          .object({
            time_created: z.number().int().min(0),
            session_id: SessionID.zod,
            sequence: z.number().int().min(0),
          })
          .optional(),
      })
      .parse(input)
    const limit = parsed.limit ?? ALL_SINCE_LIMIT
    const where = parsed.cursor
      ? and(
          gte(EventLogTable.time_created, parsed.since),
          or(
            gt(EventLogTable.time_created, parsed.cursor.time_created),
            and(
              eq(EventLogTable.time_created, parsed.cursor.time_created),
              or(
                gt(EventLogTable.session_id, parsed.cursor.session_id),
                and(
                  eq(EventLogTable.session_id, parsed.cursor.session_id),
                  gt(EventLogTable.sequence, parsed.cursor.sequence),
                ),
              ),
            ),
          ),
        )
      : gte(EventLogTable.time_created, parsed.since)

    // The predicate + ORDER BY is identical for the global table and every
    // shard; `db` is the registry or a shard client (structurally the same).
    const run = (db: Database.TxOrDb): AllSinceRow[] =>
      db
        .select({
          session_id: EventLogTable.session_id,
          event_data: EventLogTable.event_data,
          time_created: EventLogTable.time_created,
          sequence: EventLogTable.sequence,
        })
        .from(EventLogTable)
        .where(where)
        .orderBy(EventLogTable.time_created, EventLogTable.session_id, EventLogTable.sequence)
        .limit(limit)
        .all()

    if (!Flag.AX_CODE_SHARD_SESSIONS) {
      return Database.use((db) => run(db))
    }

    // Fan-out: global event_log retains every row until the later contract
    // step, while fully-sharded projects also have a copy in their shard. Run
    // the predicate on BOTH, merge by the composite key, dedupe (a backfilled
    // row exists in both places), then take the top `limit`.
    const rows = Database.use((db) => run(db))
    for (const projectID of SessionShard.activeProjectIDs()) {
      rows.push(...Shard.handle(projectID).use((db) => run(db)))
    }
    const seen = new Set<string>()
    const unique: AllSinceRow[] = []
    for (const row of rows) {
      const key = `${row.time_created}\u0000${row.session_id}\u0000${row.sequence}`
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(row)
    }
    unique.sort(compareAllSince)
    return unique.slice(0, limit)
  }

  export function insert(event: {
    id: EventLogID
    session_id: SessionID
    step_id: string | null
    event_type: string
    event_data: ReplayEvent
    sequence: number
  }) {
    const store = SessionShard.storeFor(event.session_id, { write: true })
    store.use((db) =>
      db
        .insert(EventLogTable)
        .values({
          ...event,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .run(),
    )
  }

  export type InsertEvent = {
    id: EventLogID
    session_id: SessionID
    step_id: string | null
    event_type: string
    event_data: ReplayEvent
    sequence: number
  }

  /**
   * Multi-row insert. Used by the recorder to coalesce events emitted within
   * the same microtask tick into a single SQL statement. SQLite limits
   * compound INSERTs to 500 rows by default, so we chunk to be safe.
   */
  export function insertMany(events: InsertEvent[]) {
    if (events.length === 0) return
    const now = Date.now()
    const CHUNK = 250
    if (!Flag.AX_CODE_SHARD_SESSIONS) {
      // Wrap multi-chunk inserts in a transaction so a crash between chunks
      // can't leave the event log with gaps in sequence numbers (BUG-009).
      // Recorder.flush() coalesces a microtask tick of emits into one
      // insertMany call and relies on all-or-nothing persistence.
      Database.transaction((db) => {
        for (let i = 0; i < events.length; i += CHUNK) {
          db.insert(EventLogTable)
            .values(events.slice(i, i + CHUNK).map((event) => ({ ...event, time_created: now, time_updated: now })))
            .run()
        }
      })
      return
    }
    // Flag on: a single flush batch may span sessions in different projects,
    // so group by project and write each project's events to its own shard in
    // one transaction each. Memoize session -> project: a recorder flush is
    // typically hundreds of events from one session, and the resolution is a
    // registry SELECT per lookup.
    const byProject = new Map<ProjectID, InsertEvent[]>()
    const projectBySessionID = new Map<string, ProjectID>()
    for (const event of events) {
      let projectID = projectBySessionID.get(event.session_id)
      if (!projectID) {
        projectID = SessionShard.projectIDForSession(event.session_id)
        projectBySessionID.set(event.session_id, projectID)
      }
      const group = byProject.get(projectID)
      if (group) group.push(event)
      else byProject.set(projectID, [event])
    }
    for (const [projectID, group] of byProject) {
      const store = SessionShard.storeForProject(projectID, { write: true })
      store.transaction((db) => {
        for (let i = 0; i < group.length; i += CHUNK) {
          db.insert(EventLogTable)
            .values(group.slice(i, i + CHUNK).map((event) => ({ ...event, time_created: now, time_updated: now })))
            .run()
        }
      })
    }
  }

  export function deleteBySession(sessionID: SessionID) {
    const store = SessionShard.storeFor(sessionID, { write: true })
    store.use((db) => db.delete(EventLogTable).where(eq(EventLogTable.session_id, sessionID)).run())
    if (Flag.AX_CODE_SHARD_SESSIONS) {
      // Global rows are retained until the contract step; remove them too so
      // the allSince global leg can't resurrect events deleted from the shard.
      Database.use((db) => db.delete(EventLogTable).where(eq(EventLogTable.session_id, sessionID)).run())
    }
  }

  function pruneStore(db: Database.TxOrDb, cutoff: number): number {
    const row = db
      .select({ count: sql<number>`count(*)` })
      .from(EventLogTable)
      .where(lte(EventLogTable.time_created, cutoff))
      .get()
    const count = row?.count ?? 0
    if (count === 0) return 0
    db.delete(EventLogTable).where(lte(EventLogTable.time_created, cutoff)).run()
    return count
  }

  export function pruneOlderThan(cutoffMs: number): number {
    const cutoff = Date.now() - cutoffMs
    // Wrap count + delete in a single transaction so the returned
    // count matches the number of rows actually removed (no TOCTOU).
    // The previous implementation selected all matching IDs into
    // memory just to get `.length`, then ran a separate DELETE — two
    // full scans plus a race window. COUNT(*) is O(1) memory and the
    // transaction ensures the two queries see the same snapshot.
    if (!Flag.AX_CODE_SHARD_SESSIONS) {
      return Database.transaction((db) => pruneStore(db, cutoff))
    }
    let total = Database.transaction((db) => pruneStore(db, cutoff))
    for (const projectID of SessionShard.activeProjectIDs()) {
      total += Shard.handle(projectID).transaction((db) => pruneStore(db, cutoff))
    }
    return total
  }
}
