import { Bus } from "../bus"
import { and, eq, inArray, sql } from "../storage/db"
import { MessageV2 } from "./message-v2"
import { MessageWrite } from "./message-write"
import type { SessionID } from "./schema"
import { MessageTable, PartTable } from "./session.sql"
import { SessionShard } from "./shard"

// The caller must hold the foreground OS guard throughout recovery. Never
// infer an exit code, replay a tool, or manufacture snapshot coverage here.
export namespace SessionExecutionRecovery {
  function unfinished(sessionID: SessionID, generation: string) {
    return and(
      eq(MessageTable.session_id, sessionID),
      sql`json_extract(${MessageTable.data}, '$.role') = 'assistant'`,
      sql`json_extract(${MessageTable.data}, '$.execution.version') = 1`,
      sql`json_extract(${MessageTable.data}, '$.execution.generation') = ${generation}`,
      sql`(
        (json_type(${MessageTable.data}, '$.time.completed') is not 'integer'
          and json_type(${MessageTable.data}, '$.time.completed') is not 'real')
        or exists (
          select 1 from ${PartTable}
          where ${PartTable.message_id} = ${MessageTable.id}
            and ${PartTable.session_id} = ${MessageTable.session_id}
            and (
              (json_extract(${PartTable.data}, '$.type') = 'tool'
                and json_extract(${PartTable.data}, '$.state.status') in ('pending', 'running'))
              or (json_extract(${PartTable.data}, '$.type') in ('text', 'reasoning')
                and json_type(${PartTable.data}, '$.time.start') in ('integer', 'real')
                and json_type(${PartTable.data}, '$.time.end') is not 'integer'
                and json_type(${PartTable.data}, '$.time.end') is not 'real')
            )
        )
      )`,
    )
  }

  export function hasUnfinished(sessionID: SessionID, generation: string): boolean {
    const store = SessionShard.storeFor(sessionID)
    return !!store.use((db) =>
      db.select({ id: MessageTable.id }).from(MessageTable).where(unfinished(sessionID, generation)).get(),
    )
  }

  export function recover(sessionID: SessionID, generation: string): number {
    const store = SessionShard.storeFor(sessionID, { write: true })
    return store.transaction((db) => {
      const messages = db
        .select()
        .from(MessageTable)
        .where(unfinished(sessionID, generation))
        .all()
        .map((row) => MessageV2.Assistant.parse({ ...row.data, id: row.id, sessionID: row.session_id }))
      if (messages.length === 0) return 0
      const parts = db
        .select()
        .from(PartTable)
        .where(
          and(
            eq(PartTable.session_id, sessionID),
            inArray(
              PartTable.message_id,
              messages.map((message) => message.id),
            ),
          ),
        )
        .all()
        .map((row) =>
          MessageV2.Part.parse({
            ...row.data,
            id: row.id,
            sessionID: row.session_id,
            messageID: row.message_id,
          }),
        )
      // Parse every selected row before performing the first mutation.
      const now = Date.now()
      const starts = new Map(messages.map((message) => [message.id, message.time.created]))
      const changed: MessageV2.Part[] = []
      for (const part of parts) {
        if (part.type === "tool" && (part.state.status === "pending" || part.state.status === "running")) {
          const previous = part.state
          part.state = {
            status: "error",
            input: previous.input,
            error:
              "The backend restarted during this tool call. Side effects and child-process outcomes are unknown; the action was not replayed.",
            time: {
              start: previous.status === "running" ? previous.time.start : starts.get(part.messageID)!,
              end: now,
            },
            metadata: {
              ...(previous.status === "running" ? previous.metadata : {}),
              ...(previous.status === "pending" ? { rawInput: previous.raw } : {}),
              interruptionReason: "backend_restart",
              sideEffects: "unknown",
              childProcessOutcome: "unknown",
            },
          }
          changed.push(part)
        } else if ((part.type === "text" || part.type === "reasoning") && part.time?.end === undefined) {
          part.time = { start: part.time?.start ?? starts.get(part.messageID)!, end: now }
          changed.push(part)
        }
      }
      MessageWrite.parts(db, changed, now, now)
      for (const message of messages) {
        message.time.completed ??= now
        message.error = new MessageV2.AbortedError({
          message: "The previous backend was interrupted. Tool side effects and child-process outcomes are unknown.",
          metadata: { reason: "backend_restart" },
        }).toObject()
        MessageWrite.message(db, message, now)
      }
      store.effect(() => {
        for (const part of changed) Bus.publishDetached(MessageV2.Event.PartUpdated, { part })
        for (const info of messages) Bus.publishDetached(MessageV2.Event.Updated, { info })
      })
      return messages.length
    })
  }
}
