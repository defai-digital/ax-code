import { Database, eq, and, or, inArray, desc, lt, gte, sql } from "../storage/db"
import {
  CodeNodeTable,
  CodeEdgeTable,
  CodeFileTable,
  CodeIndexCursorTable,
  type CodeNodeKind,
  type CodeEdgeKind,
} from "./schema.sql"
import type { CodeNodeID, CodeEdgeID, CodeFileID } from "./id"
import type { ProjectID } from "../project/schema"

// Low-level CRUD and lookups for the code graph. All functions are
// synchronous against Database.use (the Drizzle layer buffers writes),
// and every query is project-scoped — callers pass a ProjectID explicitly
// rather than relying on an ambient context.
//
// This file is the only place that touches CodeNodeTable / CodeEdgeTable
// / CodeFileTable / CodeIndexCursorTable directly. The public API in
// index.ts and the builder in builder.ts go through here so we can
// evolve the schema without scattering migration concerns across
// multiple call sites.

export namespace CodeGraphQuery {
  // ─── Node CRUD ──────────────────────────────────────────────────────

  export type NodeRow = typeof CodeNodeTable.$inferSelect
  export type NodeInsert = typeof CodeNodeTable.$inferInsert

  export function insertNode(row: NodeInsert): void {
    Database.use((db) => db.insert(CodeNodeTable).values(row).run())
  }

  export function insertNodes(rows: NodeInsert[]): void {
    if (rows.length === 0) return
    Database.use((db) => db.insert(CodeNodeTable).values(rows).run())
  }

  // Always filters by project_id at the SQL layer so callers can trust
  // the query for project isolation even if the same node id somehow
  // appeared in two projects (schema permits it, policy forbids it).
  export function getNode(projectID: ProjectID, id: CodeNodeID): NodeRow | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(CodeNodeTable)
        .where(and(eq(CodeNodeTable.project_id, projectID), eq(CodeNodeTable.id, id)))
        .limit(1)
        .all(),
    )[0]
  }

  export function findNodesByName(
    projectID: ProjectID,
    name: string,
    opts?: { kind?: CodeNodeKind; file?: string; limit?: number },
  ): NodeRow[] {
    const filters = [eq(CodeNodeTable.project_id, projectID), eq(CodeNodeTable.name, name)]
    if (opts?.kind) filters.push(eq(CodeNodeTable.kind, opts.kind))
    if (opts?.file) filters.push(eq(CodeNodeTable.file, opts.file))
    return Database.use((db) => {
      const q = db
        .select()
        .from(CodeNodeTable)
        .where(and(...filters))
        .orderBy(CodeNodeTable.file, CodeNodeTable.range_start_line)
      return opts?.limit ? q.limit(opts.limit).all() : q.all()
    })
  }

  export function findNodesByNamePrefix(
    projectID: ProjectID,
    prefix: string,
    opts?: { kind?: CodeNodeKind; limit?: number },
  ): NodeRow[] {
    // Use range comparison instead of `LIKE prefix%` so SQLite can use
    // code_node_project_name_idx. LIKE with a parameter is opaque to the
    // planner — it does a full scan even when an index on `name` exists.
    // The range [prefix, prefix + U+FFFF) is identical in semantics for
    // any realistic symbol name (no identifier contains U+FFFF, the
    // Unicode "not a character" sentinel).
    const upper = prefix + "\uFFFF"
    const filters = [
      eq(CodeNodeTable.project_id, projectID),
      gte(CodeNodeTable.name, prefix),
      lt(CodeNodeTable.name, upper),
    ]
    if (opts?.kind) filters.push(eq(CodeNodeTable.kind, opts.kind))
    return Database.use((db) => {
      const q = db
        .select()
        .from(CodeNodeTable)
        .where(and(...filters))
        .orderBy(CodeNodeTable.name)
      return opts?.limit ? q.limit(opts.limit).all() : q.all()
    })
  }

  export function nodesInFile(projectID: ProjectID, file: string): NodeRow[] {
    return Database.use((db) =>
      db
        .select()
        .from(CodeNodeTable)
        .where(and(eq(CodeNodeTable.project_id, projectID), eq(CodeNodeTable.file, file)))
        .orderBy(CodeNodeTable.range_start_line)
        .all(),
    )
  }

  export function deleteNodesInFile(projectID: ProjectID, file: string): void {
    Database.use((db) =>
      db
        .delete(CodeNodeTable)
        .where(and(eq(CodeNodeTable.project_id, projectID), eq(CodeNodeTable.file, file)))
        .run(),
    )
  }

  export function countNodes(projectID: ProjectID): number {
    // Use `COUNT(*)` via `.get()` instead of loading all IDs with
    // `.all().length`. For 200K nodes the previous implementation
    // allocated ~8MB per call; this is O(1) memory and much faster.
    const row = Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)` })
        .from(CodeNodeTable)
        .where(eq(CodeNodeTable.project_id, projectID))
        .get(),
    )
    return row?.count ?? 0
  }

  // ─── Edge CRUD ──────────────────────────────────────────────────────

  export type EdgeRow = typeof CodeEdgeTable.$inferSelect
  export type EdgeInsert = typeof CodeEdgeTable.$inferInsert

  export function insertEdge(row: EdgeInsert): void {
    Database.use((db) => db.insert(CodeEdgeTable).values(row).run())
  }

  export function insertEdges(rows: EdgeInsert[]): void {
    if (rows.length === 0) return
    Database.use((db) => db.insert(CodeEdgeTable).values(rows).run())
  }

  export function edgesFrom(projectID: ProjectID, fromNode: CodeNodeID, kind?: CodeEdgeKind): EdgeRow[] {
    const filters = [eq(CodeEdgeTable.project_id, projectID), eq(CodeEdgeTable.from_node, fromNode)]
    if (kind) filters.push(eq(CodeEdgeTable.kind, kind))
    return Database.use((db) =>
      db
        .select()
        .from(CodeEdgeTable)
        .where(and(...filters))
        .all(),
    )
  }

  export function edgesTo(projectID: ProjectID, toNode: CodeNodeID, kind?: CodeEdgeKind): EdgeRow[] {
    const filters = [eq(CodeEdgeTable.project_id, projectID), eq(CodeEdgeTable.to_node, toNode)]
    if (kind) filters.push(eq(CodeEdgeTable.kind, kind))
    return Database.use((db) =>
      db
        .select()
        .from(CodeEdgeTable)
        .where(and(...filters))
        .all(),
    )
  }

  export function edgesInFile(projectID: ProjectID, file: string): EdgeRow[] {
    return Database.use((db) =>
      db
        .select()
        .from(CodeEdgeTable)
        .where(and(eq(CodeEdgeTable.project_id, projectID), eq(CodeEdgeTable.file, file)))
        .all(),
    )
  }

  export function deleteEdgesInFile(projectID: ProjectID, file: string): void {
    Database.use((db) =>
      db
        .delete(CodeEdgeTable)
        .where(and(eq(CodeEdgeTable.project_id, projectID), eq(CodeEdgeTable.file, file)))
        .run(),
    )
  }

  // Delete every edge that touches the given file, not just edges whose
  // `file` column equals it. This catches imports where `to_node` lives
  // in a different file — useful for reverse-dependency invalidation.
  //
  // Two failure modes to handle:
  //   (a) File has more nodes than SQLite's IN-clause parameter limit
  //       (SQLITE_MAX_VARIABLE_NUMBER, default 999). We chunk to 500 per
  //       statement to leave headroom for the other WHERE clause params.
  //   (b) The two directions (from_node, to_node) must delete atomically.
  //       If the first succeeds and the second throws, we'd leave dangling
  //       edges. Wrap the whole operation in a transaction.
  export function deleteEdgesTouchingFile(projectID: ProjectID, file: string): void {
    const fileNodes = nodesInFile(projectID, file).map((n) => n.id)
    if (fileNodes.length === 0) return
    const CHUNK = 500
    Database.transaction((_tx) => {
      for (let i = 0; i < fileNodes.length; i += CHUNK) {
        const chunk = fileNodes.slice(i, i + CHUNK)
        Database.use((db) =>
          db
            .delete(CodeEdgeTable)
            .where(
              and(
                eq(CodeEdgeTable.project_id, projectID),
                or(inArray(CodeEdgeTable.from_node, chunk), inArray(CodeEdgeTable.to_node, chunk)),
              ),
            )
            .run(),
        )
      }
    })
  }

  export function countEdges(projectID: ProjectID): number {
    // Same rationale as countNodes — use COUNT(*) via .get() instead of
    // materializing every edge ID.
    const row = Database.use((db) =>
      db
        .select({ count: sql<number>`count(*)` })
        .from(CodeEdgeTable)
        .where(eq(CodeEdgeTable.project_id, projectID))
        .get(),
    )
    return row?.count ?? 0
  }

  // ─── File state ─────────────────────────────────────────────────────

  export type FileRow = typeof CodeFileTable.$inferSelect
  export type FileInsert = typeof CodeFileTable.$inferInsert

  export function upsertFile(row: FileInsert): void {
    Database.use((db) => {
      // Conflict target is (project_id, path) via the unique index
      // code_file_project_path_idx. Targeting `id` (which used to be
      // here) was wrong — the builder generates a fresh CodeFileID on
      // every call, so the conflict never fired and every re-index
      // appended a new row. The unique index is enforced by
      // migration 20260405063900_code_file_unique_path.
      db.insert(CodeFileTable)
        .values(row)
        .onConflictDoUpdate({
          target: [CodeFileTable.project_id, CodeFileTable.path],
          set: {
            sha: row.sha,
            size: row.size,
            lang: row.lang,
            indexed_at: row.indexed_at,
            completeness: row.completeness,
            time_updated: Date.now(),
          },
        })
        .run()
    })
  }

  export function getFile(projectID: ProjectID, path: string): FileRow | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(CodeFileTable)
        .where(and(eq(CodeFileTable.project_id, projectID), eq(CodeFileTable.path, path)))
        .limit(1)
        .all(),
    )[0]
  }

  export function listFiles(projectID: ProjectID): FileRow[] {
    return Database.use((db) =>
      db.select().from(CodeFileTable).where(eq(CodeFileTable.project_id, projectID)).orderBy(CodeFileTable.path).all(),
    )
  }

  export function deleteFile(projectID: ProjectID, path: string): void {
    Database.use((db) =>
      db
        .delete(CodeFileTable)
        .where(and(eq(CodeFileTable.project_id, projectID), eq(CodeFileTable.path, path)))
        .run(),
    )
  }

  // ─── Cursor ─────────────────────────────────────────────────────────

  export type CursorRow = typeof CodeIndexCursorTable.$inferSelect

  export function getCursor(projectID: ProjectID): CursorRow | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(CodeIndexCursorTable)
        .where(eq(CodeIndexCursorTable.project_id, projectID))
        .limit(1)
        .all(),
    )[0]
  }

  export function upsertCursor(projectID: ProjectID, commitSha: string | null, nodeCount: number, edgeCount: number) {
    Database.use((db) => {
      db.insert(CodeIndexCursorTable)
        .values({
          project_id: projectID,
          commit_sha: commitSha,
          node_count: nodeCount,
          edge_count: edgeCount,
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .onConflictDoUpdate({
          target: CodeIndexCursorTable.project_id,
          set: {
            commit_sha: commitSha,
            node_count: nodeCount,
            edge_count: edgeCount,
            time_updated: Date.now(),
          },
        })
        .run()
    })
  }

  // ─── Project-wide delete (used by tests and manual reset) ───────────

  export function clearProject(projectID: ProjectID): void {
    // Use a transaction so a crash between any two deletes cannot leave
    // the graph tables referentially inconsistent. `Database.use` with
    // multiple `.run()` calls issues four auto-commits.
    Database.transaction((db) => {
      db.delete(CodeEdgeTable).where(eq(CodeEdgeTable.project_id, projectID)).run()
      db.delete(CodeNodeTable).where(eq(CodeNodeTable.project_id, projectID)).run()
      db.delete(CodeFileTable).where(eq(CodeFileTable.project_id, projectID)).run()
      db.delete(CodeIndexCursorTable).where(eq(CodeIndexCursorTable.project_id, projectID)).run()
    })
  }

  // ─── Recently-updated nodes (for staleness checks) ──────────────────

  export function recentNodes(projectID: ProjectID, limit: number): NodeRow[] {
    return Database.use((db) =>
      db
        .select()
        .from(CodeNodeTable)
        .where(eq(CodeNodeTable.project_id, projectID))
        .orderBy(desc(CodeNodeTable.time_updated))
        .limit(limit)
        .all(),
    )
  }

  // ─── Planner statistics ─────────────────────────────────────────────

  // Refresh SQLite's query planner statistics for the code_* tables.
  // Without this, the planner picks plans based on heuristics instead of
  // real row counts. Profiling showed edgesTo was hitting a 7-cardinality
  // kind index instead of the unique-per-node to_node index — fixable
  // by a single ANALYZE call. Cheap (~100ms on 450k edges) and the
  // output persists across DB opens.
  //
  // Scoped to our tables via ANALYZE <table> to avoid touching other
  // subsystems' indexes in the shared DB.
  export function analyze(): void {
    Database.use((db) => {
      db.run(sql`ANALYZE code_node`)
      db.run(sql`ANALYZE code_edge`)
      db.run(sql`ANALYZE code_file`)
    })
  }
}
