import type { Message, Part, Session as SDKSession } from "@ax-code/sdk/v2"
import { EventLogTable } from "../../../replay/event-log.sql"
import { EventLogID } from "../../../replay"
import type { ReplayEvent } from "../../../replay/event"
import { Session } from "../../../session"
import { MessageV2 } from "../../../session/message-v2"
import { SessionTable, MessageTable, PartTable } from "../../../session/session.sql"
import { Instance } from "../../../project/instance"
import { Database } from "../../../storage/db"

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

export function writeTransfer(data: SessionTransfer) {
  const info = Session.Info.parse({
    ...data.info,
    projectID: Instance.project.id,
  })
  const row = Session.toRow(info)
  Database.use((db) =>
    db
      .insert(SessionTable)
      .values(row)
      .onConflictDoUpdate({ target: SessionTable.id, set: { project_id: row.project_id } })
      .run(),
  )

  for (const msg of data.messages) {
    const msgInfo = MessageV2.Info.parse(msg.info)
    const { id, sessionID: _sid, ...msgData } = msgInfo
    Database.use((db) =>
      db
        .insert(MessageTable)
        .values({
          id,
          session_id: row.id,
          time_created: msgInfo.time?.created ?? Date.now(),
          data: msgData,
        })
        .onConflictDoNothing()
        .run(),
    )

    for (const part of msg.parts) {
      const partInfo = MessageV2.Part.parse(part)
      const { id: partID, sessionID: _partSid, messageID, ...partData } = partInfo
      Database.use((db) =>
        db
          .insert(PartTable)
          .values({
            id: partID,
            message_id: messageID,
            session_id: row.id,
            data: partData,
          })
          .onConflictDoNothing()
          .run(),
      )
    }
  }

  for (const event of (data.events ?? []).toSorted((a, b) => a.sequence - b.sequence)) {
    Database.use((db) =>
      db
        .insert(EventLogTable)
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
        .run(),
    )
  }
}
