import { Database, eq, and, gte, lte, desc } from "../storage/db"
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
    const result = Database.use((db) =>
      db
        .select()
        .from(EventLogTable)
        .where(eq(EventLogTable.session_id, sessionID))
        .all(),
    )
    return result.length
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
    const count = Database.use((db) =>
      db
        .select({ id: EventLogTable.id })
        .from(EventLogTable)
        .where(lte(EventLogTable.time_created, cutoff))
        .all(),
    ).length
    if (count === 0) return 0
    Database.use((db) =>
      db.delete(EventLogTable).where(lte(EventLogTable.time_created, cutoff)).run(),
    )
    return count
  }
}
