import { Database, eq, and, gte, lte, desc, sql } from "../storage/db"
import { EventLogTable } from "./event-log.sql"
import { EventLogID } from "./index"
import type { ReplayEvent } from "./event"
import type { SessionID } from "../session/schema"

export namespace EventQuery {
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

  export function bySessionWithTimestamp(sessionID: SessionID): { event_data: ReplayEvent, time_created: number }[] {
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

  export function allSince(since: number): { session_id: SessionID; event_data: ReplayEvent; time_created: number }[] {
    return Database.use((db) =>
      db
        .select({
          session_id: EventLogTable.session_id,
          event_data: EventLogTable.event_data,
          time_created: EventLogTable.time_created,
        })
        .from(EventLogTable)
        .where(gte(EventLogTable.time_created, since))
        .orderBy(EventLogTable.session_id, EventLogTable.sequence)
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

  export function deleteBySession(sessionID: SessionID) {
    Database.use((db) =>
      db
        .delete(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .run(),
    )
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
