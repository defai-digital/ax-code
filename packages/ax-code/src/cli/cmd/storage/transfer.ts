import type { Message, Part, Session as SDKSession } from "@ax-code/sdk/v2"
import { EventLogTable } from "../../../replay/event-log.sql"
import { EventLogID } from "../../../replay"
import type { ReplayEvent } from "../../../replay/event"
import { Session } from "../../../session"
import { MessageV2 } from "../../../session/message-v2"
import { SessionTable, MessageTable, PartTable } from "../../../session/session.sql"
import { SessionShard } from "../../../session/shard"
import { Instance } from "../../../project/instance"
import { Flag } from "../../../flag/flag"
import { Database, eq } from "../../../storage/db"

export type TransferEvent = {
  id?: string
  stepID?: string
  sequence: number
  timeCreated: number
  event: ReplayEvent
}

export type SessionTransfer = {
  info: SDKSession
  messages: Array<{
    info: Message
    parts: Part[]
  }>
  events?: TransferEvent[]
}

export function buildTransfer(input: {
  info: SDKSession
  messages: Array<{
    info: Message
    parts: Part[]
  }>
  events: Array<{
    id: string
    step_id: string | null
    sequence: number
    time_created: number
    event_data: ReplayEvent
  }>
}): SessionTransfer {
  return {
    info: input.info,
    messages: input.messages,
    events: input.events.map((item) => ({
      id: item.id,
      stepID: item.step_id ?? undefined,
      sequence: item.sequence,
      timeCreated: item.time_created,
      event: item.event_data,
    })),
  }
}

type TransferRow = ReturnType<typeof Session.toRow>

// Message/part/event inserts shared by the registry and shard paths. They run
// on the caller's transaction (or plain client) so the same semantics apply
// wherever the content lives.
function insertTransferContent(db: Database.TxOrDb, row: TransferRow, data: SessionTransfer) {
  for (const msg of data.messages) {
    const msgInfo = MessageV2.Info.parse(msg.info)
    const { id, sessionID: _sid, ...msgData } = msgInfo
    db.insert(MessageTable)
      .values({
        id,
        session_id: row.id,
        time_created: msgInfo.time?.created ?? Date.now(),
        data: msgData,
      })
      .onConflictDoNothing()
      .run()

    for (const part of msg.parts) {
      const partInfo = MessageV2.Part.parse(part)
      const { id: partID, sessionID: _partSid, messageID: _messageID, ...partData } = partInfo
      db.insert(PartTable)
        .values({
          id: partID,
          message_id: id,
          session_id: row.id,
          data: partData,
        })
        .onConflictDoNothing()
        .run()
    }
  }

  for (const event of (data.events ?? []).toSorted((a, b) => a.sequence - b.sequence)) {
    db.insert(EventLogTable)
      .values({
        id: event.id ? EventLogID.make(event.id) : EventLogID.ascending(),
        session_id: row.id,
        step_id: event.stepID ?? null,
        event_type: event.event.type,
        event_data: event.event,
        sequence: event.sequence,
        time_created: event.timeCreated,
        time_updated: event.timeCreated,
      })
      .onConflictDoNothing()
      .run()
  }
}

export function writeTransfer(data: SessionTransfer) {
  const info = Session.Info.parse({
    ...data.info,
    projectID: Instance.project.id,
  })
  const row = Session.toRow(info)
  // Flag off: one Database.transaction so a mid-import failure (FK violation
  // on a part whose message wasn't inserted, malformed event data, etc.) rolls
  // back the whole batch instead of leaving the DB with a half-imported
  // session that has no parent row, dangling parts, or a partial event log.
  // Matches the all-or-nothing pattern used by `Session.fork`.
  //
  // Flag on: session metadata stays in the registry while messages/parts/
  // events live in the project shard, so one transaction cannot span both.
  // The registry upsert commits first and is compensated if the shard write
  // (or resolving its store) throws: restore the prior `project_id` when the
  // row already existed, otherwise delete the row this import inserted.
  if (!Flag.AX_CODE_SHARD_SESSIONS) {
    Database.transaction((db) => {
      db.insert(SessionTable)
        .values(row)
        .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
        .run()
      insertTransferContent(db, row, data)
    })
    return
  }

  // Snapshot before the first write so compensation can restore the exact
  // prior project membership (or prove the row is newly created).
  const prior = Database.use((db) =>
    db.select({ project_id: SessionTable.project_id }).from(SessionTable).where(eq(SessionTable.id, row.id)).get(),
  )
  Database.transaction((db) => {
    db.insert(SessionTable)
      .values(row)
      .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
      .run()
  })

  try {
    SessionShard.storeForProject(info.projectID, { write: true }).transaction((db) => {
      insertTransferContent(db, row, data)
    })
  } catch (error) {
    try {
      if (prior) {
        Database.use((db) =>
          db.update(SessionTable).set({ project_id: prior.project_id }).where(eq(SessionTable.id, row.id)).run(),
        )
      } else {
        Database.use((db) => db.delete(SessionTable).where(eq(SessionTable.id, row.id)).run())
      }
    } catch (compensationError) {
      throw new AggregateError(
        [error, compensationError],
        `Failed to import session ${row.id} and roll back its registry metadata`,
      )
    }
    throw error
  }
}
