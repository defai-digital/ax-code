import { Database, eq, and, or, inArray, desc, lt, gte, sql } from "../storage/db"
import {
  CodeNodeTable,
  CodeEdgeTable,
  CodeFileTable,
  CodeIndexCursorTable,
  LspCacheTable,
  type CodeNodeKind,
  type CodeEdgeKind,
  type LspCacheOperation,
  type LspCacheCompleteness,
} from "./schema.sql"
import { LspCacheID } from "./id"
import type { CodeNodeID, CodeEdgeID, CodeFileID } from "./id"
import type { ProjectID } from "../project/schema"
import { Flag } from "../flag/flag"
import { NativeStore } from "./native-store"

// Low-level CRUD and lookups for the code graph. All functions are
// synchronous against Database.use (the Drizzle layer buffers writes),
// and every query is project-scoped — callers pass a ProjectID explicitly
// rather than relying on an ambient context.
//
// When AX_CODE_NATIVE_INDEX is enabled and the native addon is available,
// operations are dispatched to the Rust-backed IndexStore for better
// performance. The Drizzle path remains as fallback.
//
// This file is the only place that touches CodeNodeTable / CodeEdgeTable
// / CodeFileTable / CodeIndexCursorTable directly. The public API in
// index.ts and the builder in builder.ts go through here so we can
// evolve the schema without scattering migration concerns across
// multiple call sites.

const useNative = Flag.AX_CODE_NATIVE_INDEX && NativeStore.available

export namespace CodeGraphQuery {
  // ─── Node CRUD ──────────────────────────────────────────────────────

  export type NodeRow = typeof CodeNodeTable.$inferSelect
  export type NodeInsert = typeof CodeNodeTable.$inferInsert

  export function insertNode(row: NodeInsert): void {
    if (useNative) return NativeStore.insertNodes([row])
    Database.use((db) => db.insert(CodeNodeTable).values(row).run())
  }

  export function insertNodes(rows: NodeInsert[]): void {
    if (rows.length === 0) return
    if (useNative) return NativeStore.insertNodes(rows)
    Database.use((db) => db.insert(CodeNodeTable).values(rows).run())
  }

  // Always filters by project_id at the SQL layer so callers can trust
  // the query for project isolation even if the same node id somehow
  // appeared in two projects (schema permits it, policy forbids it).
  export function getNode(projectID: ProjectID, id: CodeNodeID): NodeRow | undefined {
    if (useNative) return NativeStore.getNode(projectID, id)
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
    if (useNative) return NativeStore.findNodesByName(projectID, name, opts)
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
    if (useNative) return NativeStore.findNodesByNamePrefix(projectID, prefix, opts)
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
    if (useNative) return NativeStore.nodesInFile(projectID, file)
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
    if (useNative) return NativeStore.deleteNodesInFile(projectID, file)
    Database.use((db) =>
      db
        .delete(CodeNodeTable)
        .where(and(eq(CodeNodeTable.project_id, projectID), eq(CodeNodeTable.file, file)))
        .run(),
    )
  }

  export function countNodes(projectID: ProjectID): number {
    if (useNative) return NativeStore.countNodes(projectID)
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
    if (useNative) return NativeStore.insertEdges([row])
    Database.use((db) => db.insert(CodeEdgeTable).values(row).run())
  }

  export function insertEdges(rows: EdgeInsert[]): void {
    if (rows.length === 0) return
    if (useNative) return NativeStore.insertEdges(rows)
    Database.use((db) => db.insert(CodeEdgeTable).values(rows).run())
  }

  export function edgesFrom(projectID: ProjectID, fromNode: CodeNodeID, kind?: CodeEdgeKind): EdgeRow[] {
    if (useNative) return NativeStore.edgesFrom(projectID, fromNode, kind)
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
    if (useNative) return NativeStore.edgesTo(projectID, toNode, kind)
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
    if (useNative) return NativeStore.deleteEdgesTouchingFile(projectID, file)
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
    if (useNative) return NativeStore.countEdges(projectID)
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
    if (useNative) return NativeStore.upsertFile(row)
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
    if (useNative) return NativeStore.getFile(projectID, path)
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
    if (useNative) return NativeStore.listFiles(projectID)
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

  // Reconcile the code graph against a known-live file set: delete
  // every code_file / code_node / code_edge row for `projectID`
  // whose path is NOT in `livePaths`, provided the path also starts
  // with `scopePrefix`. Used by `ax-code index` to clean up files
  // that were deleted between runs (or while the watcher was
  // offline).
  //
  // The scope prefix exists for safety: the same project id can
  // appear in multiple worktrees, or the user may run the indexer
  // from a subdirectory. Without a prefix check, a walk rooted at
  // `/a/b/subproj` would delete every row for paths under
  // `/a/b/otherworktree`. Pass the walk root as `scopePrefix`; pass
  // `""` only when you genuinely intend to prune across the whole
  // project (tests, manual reset).
  //
  // Runs inside a single transaction so a reader never sees a file
  // row without its nodes or nodes without their file row. Returns
  // the counts removed so the caller can report them to the user.
  //
  // Per-orphan loop (rather than one large `WHERE path IN (...)`
  // delete) because edge deletion joins through `nodesInFile`, and
  // the orphan list in practice is tiny (0-few per run).
  export function pruneOrphanFiles(
    projectID: ProjectID,
    livePaths: Set<string>,
    scopePrefix: string,
  ): { files: number; nodes: number; edges: number } {
    if (useNative) return NativeStore.pruneOrphanFiles(projectID, [...livePaths], scopePrefix)
    const rows = Database.use((db) =>
      db.select({ path: CodeFileTable.path }).from(CodeFileTable).where(eq(CodeFileTable.project_id, projectID)).all(),
    )
    const orphans = rows
      .map((r) => r.path)
      .filter((p) => (scopePrefix === "" || p.startsWith(scopePrefix)) && !livePaths.has(p))
    if (orphans.length === 0) return { files: 0, nodes: 0, edges: 0 }

    let filesRemoved = 0
    let nodesRemoved = 0
    let edgesRemoved = 0
    Database.transaction(() => {
      for (const orphan of orphans) {
        const nodeIds = nodesInFile(projectID, orphan).map((n) => n.id)
        if (nodeIds.length > 0) {
          // Count edges touching this file before deletion. `OR` on
          // from_node and to_node catches both outgoing call edges
          // and incoming reference edges. Chunked to stay well under
          // SQLite's 999-parameter limit.
          const CHUNK = 400
          for (let i = 0; i < nodeIds.length; i += CHUNK) {
            const chunk = nodeIds.slice(i, i + CHUNK)
            const row = Database.use((db) =>
              db
                .select({ count: sql<number>`count(*)` })
                .from(CodeEdgeTable)
                .where(
                  and(
                    eq(CodeEdgeTable.project_id, projectID),
                    or(inArray(CodeEdgeTable.from_node, chunk), inArray(CodeEdgeTable.to_node, chunk)),
                  ),
                )
                .get(),
            )
            edgesRemoved += row?.count ?? 0
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
          nodesRemoved += nodeIds.length
          Database.use((db) =>
            db
              .delete(CodeNodeTable)
              .where(and(eq(CodeNodeTable.project_id, projectID), eq(CodeNodeTable.file, orphan)))
              .run(),
          )
        }
        Database.use((db) =>
          db
            .delete(CodeFileTable)
            .where(and(eq(CodeFileTable.project_id, projectID), eq(CodeFileTable.path, orphan)))
            .run(),
        )
        filesRemoved++
      }
    })
    return { files: filesRemoved, nodes: nodesRemoved, edges: edgesRemoved }
  }

  // ─── Cursor ─────────────────────────────────────────────────────────

  export type CursorRow = typeof CodeIndexCursorTable.$inferSelect

  export function getCursor(projectID: ProjectID): CursorRow | undefined {
    if (useNative) return NativeStore.getCursor(projectID)
    return Database.use((db) =>
      db.select().from(CodeIndexCursorTable).where(eq(CodeIndexCursorTable.project_id, projectID)).limit(1).all(),
    )[0]
  }

  export function upsertCursor(projectID: ProjectID, commitSha: string | null, nodeCount: number, edgeCount: number) {
    if (useNative) return NativeStore.upsertCursor(projectID, commitSha, nodeCount, edgeCount)
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
    if (useNative) return NativeStore.clearProject(projectID)
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
    if (useNative) return NativeStore.analyze()
    Database.use((db) => {
      db.run(sql`ANALYZE code_node`)
      db.run(sql`ANALYZE code_edge`)
      db.run(sql`ANALYZE code_file`)
    })
  }

  // ─── LSP response cache (S2) ────────────────────────────────────────
  //
  // Content-addressable cache for `references` and `documentSymbol`.
  // Key semantics live in LspCacheTable; this layer just wraps the
  // drizzle reads/writes so src/lsp/index.ts does not take a direct
  // dependency on the schema module.
  //
  // Not routed through NativeStore: the native IndexStore does not
  // implement cache ops. If a native path is added later, it should
  // mirror insertNode/getNode — same signature, opt-in via useNative.

  export type LspCacheRow = typeof LspCacheTable.$inferSelect

  export type LspCacheLookup = {
    projectID: ProjectID
    operation: LspCacheOperation
    filePath: string
    contentHash: string
    line: number
    character: number
    now: number
  }

  // Returns the cached row if present and not expired. Does not update
  // hit_count (caller decides whether to increment — e.g., lookup-only
  // perf probes should not inflate hit counts).
  export function getLspCache(lookup: LspCacheLookup): LspCacheRow | undefined {
    return Database.use((db) =>
      db
        .select()
        .from(LspCacheTable)
        .where(
          and(
            eq(LspCacheTable.project_id, lookup.projectID),
            eq(LspCacheTable.operation, lookup.operation),
            eq(LspCacheTable.file_path, lookup.filePath),
            eq(LspCacheTable.content_hash, lookup.contentHash),
            eq(LspCacheTable.line, lookup.line),
            eq(LspCacheTable.character, lookup.character),
            gte(LspCacheTable.expires_at, lookup.now),
          ),
        )
        .limit(1)
        .all(),
    )[0]
  }

  export function incrementLspCacheHit(id: LspCacheID): void {
    Database.use((db) =>
      db
        .update(LspCacheTable)
        .set({ hit_count: sql`${LspCacheTable.hit_count} + 1` })
        .where(eq(LspCacheTable.id, id))
        .run(),
    )
  }

  export type LspCacheInsert = {
    projectID: ProjectID
    operation: LspCacheOperation
    filePath: string
    contentHash: string
    line: number
    character: number
    payload: unknown
    serverIDs: string[]
    completeness: LspCacheCompleteness
    expiresAt: number
  }

  // Upsert on the unique key. When a fresh LSP call produces a new
  // result for the same (project, op, file, hash, line, char), we
  // overwrite rather than keep both — the content hash already
  // guarantees the payload is semantically equivalent. The overwrite
  // protects against stale `expires_at` from an older write.
  export function upsertLspCache(row: LspCacheInsert): LspCacheID {
    const id = LspCacheID.ascending()
    Database.use((db) =>
      db
        .insert(LspCacheTable)
        .values({
          id,
          project_id: row.projectID,
          operation: row.operation,
          file_path: row.filePath,
          content_hash: row.contentHash,
          line: row.line,
          character: row.character,
          payload_json: row.payload,
          server_ids_json: row.serverIDs,
          completeness: row.completeness,
          expires_at: row.expiresAt,
          hit_count: 0,
        })
        .onConflictDoUpdate({
          target: [
            LspCacheTable.project_id,
            LspCacheTable.operation,
            LspCacheTable.file_path,
            LspCacheTable.content_hash,
            LspCacheTable.line,
            LspCacheTable.character,
          ],
          set: {
            payload_json: row.payload,
            server_ids_json: row.serverIDs,
            completeness: row.completeness,
            expires_at: row.expiresAt,
          },
        })
        .run(),
    )
    return id
  }

  // Probabilistic TTL sweep. Called by the cache write path with 1%
  // probability to amortize cleanup without a background worker.
  // Returns the number of rows deleted, for observability.
  export function pruneExpiredLspCache(now: number): number {
    return Database.use((db) => {
      return db.delete(LspCacheTable).where(lt(LspCacheTable.expires_at, now)).returning({ id: LspCacheTable.id }).all().length
    })
  }

  // Explicit project-scoped eviction for perf harnesses. This keeps
  // cold-vs-warm benchmark modes reproducible instead of depending on
  // whatever payload a previous run left behind in the persistent cache.
  export function clearLspCache(projectID: ProjectID): number {
    return Database.use((db) => {
      return db
        .delete(LspCacheTable)
        .where(eq(LspCacheTable.project_id, projectID))
        .returning({ id: LspCacheTable.id })
        .all()
        .length
    })
  }
}
