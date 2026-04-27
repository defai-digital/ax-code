import { Database, eq, and, or, gt, gte, lte, desc, sql } from "../storage/db"
import { EventLogTable } from "./event-log.sql"
import { EventLogID } from "./index"
import type { ReplayEvent } from "./event"
import type { SessionID } from "../session/schema"

export namespace EventQuery {
  export const ALL_SINCE_LIMIT = 500

  export function bySession(sessionID: SessionID): ReplayEvent[] {
    return Database.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(EventLogTable.sequence)
        .all(),
    ).map((row) => row.event_data)
  }

  export function bySessionWithTimestamp(sessionID: SessionID): { event_data: ReplayEvent; time_created: number }[] {
    return Database.use((db) =>
      db
        .select({
          event_data: EventLogTable.event_data,
          time_created: EventLogTable.time_created,
        })
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .orderBy(EventLogTable.sequence)
        .all(),
    )
  }

  export function bySessionLog(sessionID: SessionID): {
    id: EventLogID
    step_id: string | null
    event_data: ReplayEvent
    sequence: number
    time_created: number
  }[] {
    return Database.use((db) =>
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
        .all(),
    )
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
    Database.use((db) => {
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
