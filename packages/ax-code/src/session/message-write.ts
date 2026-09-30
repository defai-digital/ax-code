import { type Database, eq, sql } from "../storage/db"
import type { MessageV2 } from "./message-v2"
import { MessageTable, PartTable } from "./session.sql"
import { NamedError } from "@ax-code/util/error"
import z from "zod"

// SQL only: callers own store selection, transaction boundaries, and events.
// Conflict guards enforce immutable row ownership at the final write boundary.
export namespace MessageWrite {
  export const ScopeError = NamedError.create("SessionWriteScopeError", z.object({ message: z.string() }))

  function assertOwned(result: { changes: number | bigint }, kind: "message" | "part", id: string) {
    if (Number(result.changes) === 1) return
    throw new ScopeError({ message: `Cannot reassign ${kind} ${id} to a different owner` })
  }

  // Callers must own a transaction: selecting the old stamp and inserting or
  // updating its row form one indivisible operation. A public payload cannot
  // assign ownership to a new row or change a historical row's generation.
  export function message(
    db: Database.TxOrDb,
    info: MessageV2.Info,
    timeUpdated: number,
    execution?: MessageV2.Assistant["execution"],
  ): MessageV2.Info {
    let canonical = info
    if (info.role === "assistant") {
      const existing = db
        .select({ data: MessageTable.data })
        .from(MessageTable)
        .where(eq(MessageTable.id, info.id))
        .get()
      const original =
        existing?.data.role === "assistant" && "execution" in existing.data ? existing.data.execution : undefined
      canonical = { ...info, execution: existing ? original : execution }
    }
    const { id, sessionID, ...data } = canonical
    const result = db
      .insert(MessageTable)
      .values({ id, session_id: sessionID, time_created: info.time.created, data })
      .onConflictDoUpdate({
        target: MessageTable.id,
        set: { data, time_updated: timeUpdated },
        setWhere: sql`${MessageTable.session_id} = excluded.session_id`,
      })
      .run()
    assertOwned(result, "message", id)
    return canonical
  }

  function partRow(part: MessageV2.Part, time: number, timeUpdated: number) {
    const { id, messageID, sessionID, ...data } = part
    return { id, message_id: messageID, session_id: sessionID, time_created: time, time_updated: timeUpdated, data }
  }

  export function parts(db: Database.TxOrDb, parts: readonly MessageV2.Part[], time: number, timeUpdated?: number) {
    if (parts.length === 0) return
    // Conflict-updates must stamp when the update happened, not re-use the
    // row's creation time: `time` orders rows by creation and would reset
    // time_updated to a stale value on every rewrite.
    const updated = timeUpdated ?? Date.now()

    const upsert = db
      .insert(PartTable)
      .values(
        parts.length === 1
          ? partRow(parts[0], time, updated)
          : {
              id: sql.placeholder("id"),
              message_id: sql.placeholder("message_id"),
              session_id: sql.placeholder("session_id"),
              time_created: time,
              time_updated: sql.placeholder("time_updated"),
              data: sql.placeholder("data"),
            },
      )
      .onConflictDoUpdate({
        target: PartTable.id,
        set: { data: sql`excluded.data`, time_updated: updated },
        setWhere: sql`${PartTable.message_id} = excluded.message_id and ${PartTable.session_id} = excluded.session_id`,
      })

    // Single writes do not benefit from constructing and binding placeholders.
    if (parts.length === 1) {
      const result = upsert.run()
      assertOwned(result, "part", parts[0].id)
      return
    }

    // Prepare once per synchronous batch. Keeping the statement local prevents
    // reuse across transaction contexts or closed/evicted shard connections.
    const prepared = upsert.prepare()
    for (const part of parts) {
      const result = prepared.run(partRow(part, time, updated))
      assertOwned(result, "part", part.id)
    }
  }
}
