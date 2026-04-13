import { Database, eq, desc } from "../storage/db"
import { AuditSemanticCallTable } from "./schema.sql"
import type { AuditCallID } from "./id"
import type { SessionID, MessageID } from "../session/schema"

// Storage-layer ops for audit_semantic_call. The higher-level writer
// in src/audit/semantic-call.ts decides *when* to call these (queued
// vs synchronous); this file only covers *what* gets written.
//
// Callers pass drizzle-native shapes — AuditCallID is generated at
// this layer so the queue writer can refer to rows by id without
// first issuing an insert.

export namespace AuditQuery {
  export type Row = typeof AuditSemanticCallTable.$inferSelect

  export type Insert = {
    id: AuditCallID
    session_id: SessionID
    message_id: MessageID | null
    tool: string
    operation: string
    args_json: unknown
    envelope_json: unknown
    error_code: string | null
  }

  export function insert(row: Insert): void {
    Database.use((db) =>
      db
        .insert(AuditSemanticCallTable)
        .values({
          id: row.id,
          session_id: row.session_id,
          message_id: row.message_id ?? undefined,
          tool: row.tool,
          operation: row.operation,
          args_json: row.args_json,
          envelope_json: row.envelope_json,
          error_code: row.error_code ?? undefined,
        })
        .run(),
    )
  }

  // Batch insert for the queued writer's flush path. Drizzle
  // translates to a single multi-VALUES INSERT so we pay one DB
  // round-trip per flush instead of one per row.
  export function insertMany(rows: Insert[]): void {
    if (rows.length === 0) return
    Database.use((db) =>
      db
        .insert(AuditSemanticCallTable)
        .values(
          rows.map((row) => ({
            id: row.id,
            session_id: row.session_id,
            message_id: row.message_id ?? undefined,
            tool: row.tool,
            operation: row.operation,
            args_json: row.args_json,
            envelope_json: row.envelope_json,
            error_code: row.error_code ?? undefined,
          })),
        )
        .run(),
    )
  }

  export function getById(id: AuditCallID): Row | undefined {
    return Database.use((db) =>
      db.select().from(AuditSemanticCallTable).where(eq(AuditSemanticCallTable.id, id)).limit(1).all(),
    )[0]
  }

  // Most-recent rows, bounded for the replay/debug UX. Not paged —
  // the caller passes a hard limit.
  export function listRecent(sessionID: SessionID, limit: number): Row[] {
    return Database.use((db) =>
      db
        .select()
        .from(AuditSemanticCallTable)
        .where(eq(AuditSemanticCallTable.session_id, sessionID))
        .orderBy(desc(AuditSemanticCallTable.time_created))
        .limit(limit)
        .all(),
    )
  }
}
