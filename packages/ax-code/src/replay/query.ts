import { Database, eq, and, or, gt, gte, lte, desc, sql } from "../storage/db"
import { EventLogTable } from "./event-log.sql"
import { EventLogID } from "./index"
import type { ReplayEvent } from "./event"
import type { SessionID } from "../session/schema"
import { Log } from "../util/log"

export namespace EventQuery {
  const log = Log.create({ service: "replay.query" })

  export const ALL_SINCE_LIMIT = 500
  // Per-session full-log loads are capped to bound peak memory for
  // pathologically long sessions. tool.result events can each carry
  // megabytes of stdout, so an unbounded `.all()` over a 5k-event log
  // can hold hundreds of MB resident — and Replay.compare() doubles
  // that by reconstructing twice (BUG-006). 10k matches the largest
  // session size we've seen in practice; callers that genuinely need
  // unbounded reads should paginate via `allSince`.
  export const BY_SESSION_LIMIT = 10_000

  // When a per-session loader returns exactly BY_SESSION_LIMIT rows the
  // caller may be operating on a truncated view (Replay.compare /
  // reconstructStream silently produce wrong results in that case). We
  // can't tell from the returned slice alone whether more rows existed,
  // so we COUNT(*) and warn loudly if so. The cost is one cheap indexed
  // count query; only paid when the limit is actually hit.
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

  export function bySession(sessionID: SessionID): ReplayEvent[] {
    const rows = Database.use((db) =>
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

  export function recentBySession(sessionID: SessionID, limit = 500): ReplayEvent[] {
    const rows = Database.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(desc(EventLogTable.sequence))
        .limit(Math.max(0, Math.min(limit, BY_SESSION_LIMIT)))
        .all(),
    )
    return rows.reverse().map((row) => row.event_data)
  }

  export function bySessionWithTimestamp(sessionID: SessionID): { event_data: ReplayEvent; time_created: number }[] {
    const rows = Database.use((db) =>
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

  export function bySessionLog(sessionID: SessionID): {
    id: EventLogID
    step_id: string | null
    event_data: ReplayEvent
    sequence: number
    time_created: number
  }[] {
    const rows = Database.use((db) =>
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
    return Database.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(and(eq(EventLogTable.session_id, sessionID), eq(EventLogTable.event_type, type)))
        .orderBy(EventLogTable.sequence)
        .all(),
    ).map((row) => row.event_data)
  }

  export function count(sessionID: SessionID): number {
    // Use COUNT(*) via .get() instead of loading every row to count
    // them. See code-intelligence/query.ts countNodes for rationale.
    const row = Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)` })
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .get(),
    )
    return row?.count ?? 0
  }

  export function allSince(input: {
    since: number
    limit?: number
    cursor?: {
      time_created: number
      session_id: SessionID
      sequence: number
    }
  }): { session_id: SessionID; event_data: ReplayEvent; time_created: number; sequence: number }[] {
    const where = input.cursor
      ? and(
          gte(EventLogTable.time_created, input.since),
          or(
            gt(EventLogTable.time_created, input.cursor.time_created),
            and(
              eq(EventLogTable.time_created, input.cursor.time_created),
              or(
                gt(EventLogTable.session_id, input.cursor.session_id),
                and(
                  eq(EventLogTable.session_id, input.cursor.session_id),
                  gt(EventLogTable.sequence, input.cursor.sequence),
                ),
              ),
            ),
          ),
        )
      : gte(EventLogTable.time_created, input.since)
    return Database.use((db) =>
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
        .limit(input.limit ?? ALL_SINCE_LIMIT)
        .all(),
    )
  }

  export function insert(event: {
    id: EventLogID
    session_id: SessionID
    step_id: string | null
    event_type: string
    event_data: ReplayEvent
    sequence: number
  }) {
    Database.use((db) =>
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
    const rows = events.map((event) => ({ ...event, time_created: now, time_updated: now }))
    const CHUNK = 250
    // Wrap multi-chunk inserts in a transaction so a crash between chunks
    // can't leave the event log with gaps in sequence numbers (BUG-009).
    // Recorder.flush() coalesces a microtask tick of emits into one
    // insertMany call and relies on all-or-nothing persistence.
    Database.transaction((db) => {
      for (let i = 0; i < rows.length; i += CHUNK) {
        db.insert(EventLogTable)
          .values(rows.slice(i, i + CHUNK))
          .run()
      }
    })
  }

  export function deleteBySession(sessionID: SessionID) {
    Database.use((db) => db.delete(EventLogTable).where(eq(EventLogTable.session_id, sessionID)).run())
  }

  export function pruneOlderThan(cutoffMs: number): number {
    const cutoff = Date.now() - cutoffMs
    // Wrap count + delete in a single transaction so the returned
    // count matches the number of rows actually removed (no TOCTOU).
    // The previous implementation selected all matching IDs into
    // memory just to get `.length`, then ran a separate DELETE — two
    // full scans plus a race window. COUNT(*) is O(1) memory and the
    // transaction ensures the two queries see the same snapshot.
    return Database.transaction((db) => {
      const row = db
        .select({ count: sql<number>`count(*)` })
        .from(EventLogTable)
        .where(lte(EventLogTable.time_created, cutoff))
        .get()
      const count = row?.count ?? 0
      if (count === 0) return 0
      db.delete(EventLogTable).where(lte(EventLogTable.time_created, cutoff)).run()
      return count
    })
  }
}
