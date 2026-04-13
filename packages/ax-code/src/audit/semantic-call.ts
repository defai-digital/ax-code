import { Log } from "../util/log"
import { Flag } from "../flag/flag"
import { AuditQuery } from "./query"
import { AuditCallID } from "./id"
import type { SessionID, MessageID } from "../session/schema"

// Semantic-call audit writer (Semantic Trust Layer PRD §S3).
//
// Default: queue-by-default. Each record() call pushes into an in-
// process array and schedules a single pending flush on setImmediate.
// AI tool calls return immediately; the audit row lands in SQLite at
// the next tick boundary.
//
// AX_CODE_AUDIT_SYNC=1: synchronous. Each record() blocks on the DB
// write. The tool call's latency includes the write. Compliance mode.
//
// Failure policy (queued): a flush failure logs the error and drops
// the batch. This is a known trade-off of queue mode — see PRD §S3
// risk 2. Synchronous mode surfaces the error to the caller.
//
// Crash durability (queued): unflushed rows are lost on hard crash.
// Session teardown calls flushNow() to bound the window to "last
// ~tick boundary" in normal shutdown.

const log = Log.create({ service: "audit.semantic-call" })

export namespace AuditSemanticCall {
  export type RecordInput = {
    sessionID: SessionID
    messageID?: MessageID
    tool: string
    operation: string
    args: unknown
    envelope: unknown
    errorCode?: string
  }

  const queue: AuditQuery.Insert[] = []
  let flushScheduled = false

  function toRow(input: RecordInput): AuditQuery.Insert {
    return {
      id: AuditCallID.ascending(),
      session_id: input.sessionID,
      message_id: input.messageID ?? null,
      tool: input.tool,
      operation: input.operation,
      args_json: input.args,
      envelope_json: input.envelope,
      error_code: input.errorCode ?? null,
    }
  }

  function flushQueue(): void {
    if (queue.length === 0) return
    // Splice instead of reset to preserve referential semantics if a
    // caller ever captures the array (it shouldn't, but splice is
    // cheap and leaves no footguns).
    const batch = queue.splice(0, queue.length)
    try {
      AuditQuery.insertMany(batch)
    } catch (err) {
      log.warn("flush failed; dropping batch", {
        size: batch.length,
        err: err instanceof Error ? err.message : String(err),
      })
    }
  }

  function scheduleFlush(): void {
    if (flushScheduled) return
    flushScheduled = true
    setImmediate(() => {
      flushScheduled = false
      flushQueue()
    })
  }

  // Record one semantic call. In queue mode returns immediately; in
  // sync mode blocks until the row is durable. Sync mode surfaces DB
  // errors to the caller by re-throwing; queue mode swallows them on
  // flush (see failure policy above).
  export function record(input: RecordInput): AuditCallID {
    const row = toRow(input)
    if (Flag.AX_CODE_AUDIT_SYNC) {
      AuditQuery.insert(row)
      return row.id
    }
    queue.push(row)
    scheduleFlush()
    return row.id
  }

  // Drain the queue immediately. Used by session teardown to bound
  // the crash-durability window and by tests that need to observe
  // written rows synchronously.
  export function flushNow(): void {
    flushQueue()
  }

  // Current queue depth, for tests + observability.
  export function pendingCount(): number {
    return queue.length
  }
}
