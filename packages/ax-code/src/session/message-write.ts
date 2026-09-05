import { type Database, sql } from "../storage/db"
import type { MessageV2 } from "./message-v2"
import { MessageTable, PartTable } from "./session.sql"

// SQL only: callers own scope validation, store selection, transactions, and events.
export namespace MessageWrite {
  export function message(db: Database.TxOrDb, info: MessageV2.Info, timeUpdated: number) {
    const { id, sessionID, ...data } = info
    db.insert(MessageTable)
      .values({ id, session_id: sessionID, time_created: info.time.created, data })
      .onConflictDoUpdate({ target: MessageTable.id, set: { data, time_updated: timeUpdated } })
      .run()
  }

  function partRow(part: MessageV2.Part, time: number) {
    const { id, messageID, sessionID, ...data } = part
    return { id, message_id: messageID, session_id: sessionID, time_created: time, time_updated: Date.now(), data }
  }

  export function parts(db: Database.TxOrDb, parts: readonly MessageV2.Part[], time: number) {
    if (parts.length === 0) return

    const upsert = db
      .insert(PartTable)
      .values(
        parts.length === 1
          ? partRow(parts[0], time)
          : {
              id: sql.placeholder("id"),
              message_id: sql.placeholder("message_id"),
              session_id: sql.placeholder("session_id"),
              time_created: time,
              time_updated: sql.placeholder("time_updated"),
              data: sql.placeholder("data"),
            },
      )
      .onConflictDoUpdate({ target: PartTable.id, set: { data: sql`excluded.data`, time_updated: time } })

    // Single writes do not benefit from constructing and binding placeholders.
    if (parts.length === 1) {
      upsert.run()
      return
    }

    // Prepare once per synchronous batch. Keeping the statement local prevents
    // reuse across transaction contexts or closed/evicted shard connections.
    const prepared = upsert.prepare()
    for (const part of parts) {
      prepared.run(partRow(part, time))
    }
  }
}
