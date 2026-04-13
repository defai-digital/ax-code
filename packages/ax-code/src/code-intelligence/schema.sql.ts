import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core"
import { ProjectTable } from "../project/project.sql"
import type { ProjectID } from "../project/schema"
import type { CodeNodeID, CodeEdgeID, CodeFileID, LspCacheID } from "./id"
import { Timestamps } from "../storage/schema.sql"

// Graph node: a named, locatable entity in the codebase. The union is
// intentionally coarse — we normalize to a lowest-common-denominator kind
// across languages. Language-specific details live in `metadata`.
export type CodeNodeKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "variable"
  | "constant"
  | "module"
  | "parameter"
  | "enum"

export const CodeNodeTable = sqliteTable(
  "code_node",
  {
    id: text().$type<CodeNodeID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    kind: text().$type<CodeNodeKind>().notNull(),
    name: text().notNull(),
    // Full qualified name including module path or parent scope, e.g.
    // "src/session/compaction.ts::SessionCompaction::isOverflow". Used for
    // disambiguation when multiple nodes share a short name.
    qualified_name: text().notNull(),
    file: text().notNull(),
    range_start_line: integer().notNull(),
    range_start_char: integer().notNull(),
    range_end_line: integer().notNull(),
    range_end_char: integer().notNull(),
    // Optional type signature as a single string, normalized per-language.
    // Used for display in query results and to detect signature changes
    // during incremental updates without a full re-parse.
    signature: text(),
    // public | private | protected | internal — null when the language
    // doesn't express visibility or when the LSP didn't report it.
    visibility: text(),
    // Opaque per-language metadata. Anything that doesn't fit the
    // lowest-common-denominator schema goes here as JSON.
    metadata: text({ mode: "json" }).$type<Record<string, unknown>>(),
    ...Timestamps,
  },
  (table) => [
    index("code_node_project_idx").on(table.project_id),
    index("code_node_project_name_idx").on(table.project_id, table.name),
    index("code_node_project_file_idx").on(table.project_id, table.file),
    index("code_node_project_kind_idx").on(table.project_id, table.kind),
    index("code_node_qualified_idx").on(table.project_id, table.qualified_name),
  ],
)

// Graph edge: a directed relationship between two nodes. The kinds cover
// the dominant reasoning cases: call graphs (calls), reference lookups
// (references), module imports (imports), and class hierarchy (extends,
// implements). "defines" links a module-kind node to each top-level
// symbol it defines; "declared_in" is the reverse.
export type CodeEdgeKind =
  | "calls"
  | "references"
  | "imports"
  | "extends"
  | "implements"
  | "defines"
  | "declared_in"

export const CodeEdgeTable = sqliteTable(
  "code_edge",
  {
    id: text().$type<CodeEdgeID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    kind: text().$type<CodeEdgeKind>().notNull(),
    from_node: text().$type<CodeNodeID>().notNull(),
    to_node: text().$type<CodeNodeID>().notNull(),
    // The file where this edge was observed. Usually the file containing
    // `from_node`, but stored explicitly to make file-level invalidation
    // a single-column lookup instead of a join.
    file: text().notNull(),
    range_start_line: integer().notNull(),
    range_start_char: integer().notNull(),
    range_end_line: integer().notNull(),
    range_end_char: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("code_edge_project_idx").on(table.project_id),
    index("code_edge_from_idx").on(table.project_id, table.from_node),
    index("code_edge_to_idx").on(table.project_id, table.to_node),
    index("code_edge_project_file_idx").on(table.project_id, table.file),
    index("code_edge_project_kind_idx").on(table.project_id, table.kind),
  ],
)

// File-level index state. Tracks what we've seen and when, so incremental
// updates can invalidate only the files that changed.
export const CodeFileTable = sqliteTable(
  "code_file",
  {
    id: text().$type<CodeFileID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    path: text().notNull(),
    // Content hash (Bun.hash) of the last indexed version. Used to detect
    // whether a reindex is actually needed after a file-watcher event.
    sha: text().notNull(),
    size: integer().notNull(),
    lang: text().notNull(),
    indexed_at: integer().notNull(),
    // "full" = indexed via LSP (precise). "partial" = indexed via
    // tree-sitter (symbols only, no cross-references). "lsp-only" =
    // indexed via LSP but the server didn't answer some queries.
    completeness: text().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("code_file_project_idx").on(table.project_id),
    // UNIQUE: upsertFile's ON CONFLICT target. Prevents duplicate file
    // rows when the builder re-indexes a path with a fresh CodeFileID.
    // See migration 20260405063900_code_file_unique_path for the fix.
    uniqueIndex("code_file_project_path_idx").on(table.project_id, table.path),
  ],
)

// Project-level cursor: the commit SHA we were at for the last full
// indexing pass. When git state moves, we compare this cursor to the
// current HEAD and compute the affected file set.
export const CodeIndexCursorTable = sqliteTable("code_index_cursor", {
  project_id: text()
    .$type<ProjectID>()
    .primaryKey()
    .references(() => ProjectTable.id, { onDelete: "cascade" }),
  commit_sha: text(),
  // Total nodes and edges at last pass — cheap to update, useful for
  // health metrics and for detecting "graph mysteriously empty" bugs.
  node_count: integer().notNull(),
  edge_count: integer().notNull(),
  ...Timestamps,
})

// LSP response cache (Semantic Trust Layer PRD §S2).
//
// Correctness model: content-addressable. The unique key includes a
// SHA-256 (or Bun.hash) of the file content at query time, so a stale
// row is *unreachable* once the file content changes — the new hash
// won't match the cached one. No watcher hook, no active invalidation:
// when content changes, the old row simply ages out via TTL.
//
// Scope: AI-facing `references` and `documentSymbol` calls only.
// workspaceSymbol is not cached here (requires cross-file invalidation
// logic that belongs in its own PRD). hover/definition are not cached
// because the hit rate at their typical call frequency doesn't justify
// the write cost — revisit after v1 telemetry.
//
// Feature flag: entries are only written/read when AX_CODE_LSP_CACHE=1.
// Default off for the first release window.
export type LspCacheOperation = "references" | "documentSymbol"
export type LspCacheCompleteness = "full" | "partial"

export const LspCacheTable = sqliteTable(
  "code_intel_lsp_cache",
  {
    id: text().$type<LspCacheID>().primaryKey(),
    project_id: text()
      .$type<ProjectID>()
      .notNull()
      .references(() => ProjectTable.id, { onDelete: "cascade" }),
    operation: text().$type<LspCacheOperation>().notNull(),
    file_path: text().notNull(),
    // Content hash of the file at the moment the LSP call was issued.
    // SHA-256 hex (64 chars). Must match exactly for a row to be reused.
    content_hash: text().notNull(),
    // Position at which the query was made. For documentSymbol the
    // position is meaningless; we store -1/-1 as a sentinel so the
    // uniqueIndex composition works for both operations.
    line: integer().notNull(),
    character: integer().notNull(),
    // JSON serialization of the envelope's `data` field — the raw LSP
    // payload as returned to the caller.
    payload_json: text({ mode: "json" }).$type<unknown>().notNull(),
    // JSON array of server IDs that contributed to this cached result.
    server_ids_json: text({ mode: "json" }).$type<string[]>().notNull(),
    // Only `full` results are ever written (partial/empty are skipped on
    // the write path), but the column is kept for forward-compat so a
    // future policy can relax that rule without a migration.
    completeness: text().$type<LspCacheCompleteness>().notNull(),
    hit_count: integer().notNull().default(0),
    // Absolute epoch ms at which this row becomes stale. Reads past this
    // time are treated as misses. TTL is 24h by default, enforced by
    // probabilistic pruneExpired() on writes.
    expires_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [
    index("code_intel_lsp_cache_project_idx").on(table.project_id),
    // UNIQUE on the content-addressable key. insert-or-replace on hit
    // semantics lean on this constraint.
    uniqueIndex("code_intel_lsp_cache_key_idx").on(
      table.project_id,
      table.operation,
      table.file_path,
      table.content_hash,
      table.line,
      table.character,
    ),
    // Cheap scan for pruneExpired().
    index("code_intel_lsp_cache_expires_idx").on(table.expires_at),
  ],
)
