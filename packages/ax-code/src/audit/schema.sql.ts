import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import { SessionTable } from "../session/session.sql"
import type { SessionID, MessageID } from "../session/schema"
import type { AuditCallID } from "./id"
import { Timestamps } from "../storage/schema.sql"

// Semantic call audit trail (Semantic Trust Layer PRD §S3).
//
// One row per AI-facing semantic tool execution. Captures the operation
// the AI issued, the exact args, and the SemanticEnvelope that was
// returned to it. This is the durable record that lets the replay
// command re-execute a recorded call and assert decision-path
// equivalence (source / completeness / cacheKey).
//
// Write modes:
//   - Queued (default): writes buffered in-process, flushed on tick
//     boundary and on session teardown. Availability over pedantry —
//     AI tool calls never block on DB contention.
//   - Synchronous (AX_CODE_AUDIT_SYNC=1): blocks the tool until the
//     row is persisted. Compliance mode only; accept latency cost.
//
// Scope is session-scoped — the FK cascades on session delete. For a
// project-scoped or export-friendly schema, see future Enterprise PRD.
//
// message_id is intentionally NOT an FK. Messages can be deleted
// (compaction, revert) while the audit trail should persist; we store
// the id for correlation but don't cascade.
export const AuditSemanticCallTable = sqliteTable(
  "audit_semantic_call",
  {
    id: text().$type<AuditCallID>().primaryKey(),
    session_id: text()
      .$type<SessionID>()
      .notNull()
      .references(() => SessionTable.id, { onDelete: "cascade" }),
    // Correlating message id, if the call happened inside a message
    // scope. Not an FK — see comment above.
    message_id: text().$type<MessageID>(),
    // The tool that made the call, e.g. "lsp". Kept as free text so we
    // can add future tools (codeIntel, dre) without a migration.
    tool: text().notNull(),
    // The operation within the tool, e.g. "references", "workspaceSymbol".
    operation: text().notNull(),
    // Exact args passed to the tool, JSON-serialized. Read by replay.
    args_json: text({ mode: "json" }).$type<unknown>().notNull(),
    // The SemanticEnvelope that was returned. For failed calls the
    // envelope is synthesized with completeness="empty" and an error
    // field so replay can surface the failure mode.
    envelope_json: text({ mode: "json" }).$type<unknown>().notNull(),
    // Null on success; error name (or "unknown") on failure. Makes
    // querying failed calls cheap without parsing envelope JSON.
    error_code: text(),
    ...Timestamps,
  },
  (table) => [
    index("audit_semantic_call_session_idx").on(table.session_id),
    index("audit_semantic_call_tool_op_idx").on(table.tool, table.operation),
    index("audit_semantic_call_created_idx").on(table.time_created),
  ],
)
