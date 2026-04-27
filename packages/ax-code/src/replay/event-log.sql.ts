import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import type { SessionID } from "../session/schema"
import type { EventLogID } from "./index"
import type { ReplayEvent } from "./event"
import { Timestamps } from "../storage/schema.sql"

export const EventLogTable = sqliteTable(
  "event_log",
  {
    id: text().$type<EventLogID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    step_id: text(),
    event_type: text().notNull(),
    event_data: text({ mode: "json" }).notNull().$type<ReplayEvent>(),
    sequence: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("event_log_session_idx").on(table.session_id),
    index("event_log_session_sequence_idx").on(table.session_id, table.sequence),
    // Backs EventQuery.bySessionAndType (e.g. "agent.route" lookups).
    // Without this, sessions with thousands of events scan the whole
    // session range to filter by event_type. Sequence is included so
    // the orderBy can be satisfied by the index.
    index("event_log_session_type_sequence_idx").on(table.session_id, table.event_type, table.sequence),
    index("event_log_time_created_idx").on(table.time_created),
  ],
)
