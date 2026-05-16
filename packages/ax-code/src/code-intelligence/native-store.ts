import { Log } from "../util/log"
import { Global } from "../global"
import { NativePerf } from "../perf/native"
import { NativeAddon } from "../native/addon"
import type { ProjectID } from "../project/schema"
import type { CodeNodeID, CodeEdgeID, CodeFileID } from "./id"
import type { CodeNodeKind, CodeEdgeKind } from "./schema.sql"

const log = Log.create({ service: "code-intelligence.native-store" })

let storeInstance: any | undefined
// Once `NativeStore.close()` runs we must not lazily reopen a fresh
// connection on the next op call — that would defeat the shutdown release
// and resurface BUG-008. The flag stays set for the rest of the process
// lifetime; a clean reopen requires a new process.
let storeClosed = false

function getDbPath(): string {
  return Global.Path.data + "/ax-code-index.db"
}

function store(): any {
  if (storeClosed) return undefined
  if (storeInstance) return storeInstance
  const native = NativeAddon.index()
  if (!native) return undefined
  try {
    storeInstance = new native.IndexStore(getDbPath())
  } catch (err) {
    log.warn("failed to initialize native IndexStore", { error: String(err) })
  }
  return storeInstance
}

function op<T>(name: string, input: unknown, fn: (store: any) => T): T | undefined {
  const value = store()
  if (!value) return
  return NativePerf.run(`index.${name}`, input, () => fn(value))
}

export namespace NativeStore {
  export const available = !!NativeAddon.index()

  /**
   * Release the native IndexStore's SQLite connection. Idempotent. Wires
   * into `Database.close()` so `ax-code` shutdown paths release the
   * `ax-code-index.db` fd and run the final WAL checkpoint instead of
   * leaking it for the lifetime of the process (BUG-008).
   *
   * After close the singleton is cleared and the closed flag is set, so
   * further `op()` calls fall through to the no-native-addon path
   * (returning `undefined` / `[]` like the addon-not-available branch).
   * Callers don't need to special-case post-close behaviour.
   */
  export function close(): void {
    if (storeClosed) return
    storeClosed = true
    const instance = storeInstance
    storeInstance = undefined
    if (!instance) return
    try {
      instance.close()
    } catch (err) {
      log.warn("native IndexStore close failed", { error: String(err) })
    }
  }

  // Safe JSON.parse wrapper — returns fallback on corrupted native output (BUG-005)
  function safeParse<T>(json: string, fallback: T): T {
    try {
      return JSON.parse(json)
    } catch {
      log.warn("native store returned malformed JSON", { length: json?.length })
      return fallback
    }
  }

  // ─── Node operations ──────────────────────────────────────────────

  export function insertNodes(rows: any[]): void {
    op("insertNodes", { rows: rows.length }, (store) => store.insertNodes(JSON.stringify(rows)))
  }

  export function getNode(projectID: ProjectID, id: CodeNodeID): any | undefined {
    const result = op("getNode", { projectID, id }, (store) => store.getNode(projectID, id))
    return result ? safeParse(result, undefined) : undefined
  }

  export function findNodesByName(
    projectID: ProjectID,
    name: string,
    opts?: { kind?: CodeNodeKind; file?: string; limit?: number },
  ): any[] {
    const result = op("findNodesByName", { projectID, name, opts }, (store) =>
      store.findNodesByName(projectID, name, JSON.stringify(opts ?? {})),
    )
    return result ? safeParse(result, []) : []
  }

  export function findNodesByNamePrefix(
    projectID: ProjectID,
    prefix: string,
    opts?: { kind?: CodeNodeKind; limit?: number },
  ): any[] {
    const result = op("findNodesByPrefix", { projectID, prefix, opts }, (store) =>
      store.findNodesByPrefix(projectID, prefix, JSON.stringify(opts ?? {})),
    )
    return result ? safeParse(result, []) : []
  }

  export function nodesInFile(projectID: ProjectID, file: string): any[] {
    const result = op("nodesInFile", { projectID, file }, (store) => store.nodesInFile(projectID, file))
    return result ? safeParse(result, []) : []
  }

  export function countNodes(projectID: ProjectID): number {
    return op("countNodes", { projectID }, (store) => store.countNodes(projectID)) ?? 0
  }

  export function deleteNodesInFile(projectID: ProjectID, file: string): void {
    op("deleteNodesInFile", { projectID, file }, (store) => store.deleteNodesInFile(projectID, file))
  }

  // ─── Edge operations ──────────────────────────────────────────────

  export function insertEdges(rows: any[]): void {
    op("insertEdges", { rows: rows.length }, (store) => store.insertEdges(JSON.stringify(rows)))
  }

  export function edgesFrom(projectID: ProjectID, fromNode: CodeNodeID, kind?: CodeEdgeKind): any[] {
    const result = op("edgesFrom", { projectID, fromNode, kind }, (store) =>
      store.edgesFrom(projectID, fromNode, kind ?? null),
    )
    return result ? safeParse(result, []) : []
  }

  export function edgesTo(projectID: ProjectID, toNode: CodeNodeID, kind?: CodeEdgeKind): any[] {
    const result = op("edgesTo", { projectID, toNode, kind }, (store) => store.edgesTo(projectID, toNode, kind ?? null))
    return result ? safeParse(result, []) : []
  }

  export function edgesInFile(projectID: ProjectID, file: string): any[] {
    const result = op("edgesInFile", { projectID, file }, (store) => store.edgesInFile(projectID, file))
    return result ? safeParse(result, []) : []
  }

  export function deleteEdgesTouchingFile(projectID: ProjectID, file: string): void {
    op("deleteEdgesTouchingFile", { projectID, file }, (store) => store.deleteEdgesTouchingFile(projectID, file))
  }

  export function countEdges(projectID: ProjectID): number {
    return op("countEdges", { projectID }, (store) => store.countEdges(projectID)) ?? 0
  }

  // ─── File operations ─────────��────────────────────────────────────

  export function upsertFile(row: any): void {
    op("upsertFile", { projectID: row.project_id, path: row.path }, (store) => store.upsertFile(JSON.stringify(row)))
  }

  export function getFile(projectID: ProjectID, path: string): any | undefined {
    const result = op("getFile", { projectID, path }, (store) => store.getFile(projectID, path))
    return result ? safeParse(result, undefined) : undefined
  }

  export function listFiles(projectID: ProjectID): any[] {
    const result = op("listFiles", { projectID }, (store) => store.listFiles(projectID))
    return result ? safeParse(result, []) : []
  }

  export function pruneOrphanFiles(
    projectID: ProjectID,
    livePaths: string[],
    scopePrefix: string,
  ): { files: number; nodes: number; edges: number } {
    const result = op("pruneOrphanFiles", { projectID, livePaths: livePaths.length, scopePrefix }, (store) =>
      store.pruneOrphanFiles(projectID, JSON.stringify(livePaths), scopePrefix),
    )
    return result ? safeParse(result, { files: 0, nodes: 0, edges: 0 }) : { files: 0, nodes: 0, edges: 0 }
  }

  // ─── Cursor operations ──────���─────────────────────────────────────

  export function getCursor(projectID: ProjectID): any | undefined {
    const result = op("getCursor", { projectID }, (store) => store.getCursor(projectID))
    return result ? safeParse(result, undefined) : undefined
  }

  export function upsertCursor(
    projectID: ProjectID,
    commitSha: string | null,
    nodeCount: number,
    edgeCount: number,
  ): void {
    op("upsertCursor", { projectID, commitSha, nodeCount, edgeCount }, (store) =>
      store.upsertCursor(projectID, commitSha, nodeCount, edgeCount),
    )
  }

  // ─── Project operations ──────────────���────────────────────────────

  export function clearProject(projectID: ProjectID): void {
    op("clearProject", { projectID }, (store) => store.clearProject(projectID))
  }

  export function analyze(): void {
    op("analyze", undefined, (store) => store.analyze())
  }

  // ─── Atomic ingest ────���─────────────────────────────────��─────────

  export function ingestFile(projectID: ProjectID, filePath: string, nodes: any[], edges: any[], fileMeta: any): void {
    op("ingestFile", { projectID, filePath, nodes: nodes.length, edges: edges.length }, (store) =>
      store.ingestFile(projectID, filePath, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify(fileMeta)),
    )
  }

  // ─── IntervalTree ─���───────────────────────────────────────────────

  export function createIntervalTree(): any | undefined {
    const native = NativeAddon.index()
    if (!native) return undefined
    return new native.IntervalTree()
  }

  // ─── Advisory Lock ─────────────────────────────────────���──────────

  export function createAdvisoryLock(lockPath: string): any | undefined {
    const native = NativeAddon.index()
    if (!native) return undefined
    return new native.AdvisoryLock(lockPath)
  }

  // ─── Hashing ──────────────────────────────────────────────────────

  export function hashSha256(data: Buffer): string | undefined {
    const native = NativeAddon.index()
    if (!native) return undefined
    return NativePerf.run("index.hashSha256", data.byteLength, () => native.hashSha256(data))
  }

  // ─── ID Generation ────────────��───────────────────────────────────

  export function generateId(prefix: string): string | undefined {
    const native = NativeAddon.index()
    if (!native) return undefined
    return NativePerf.run("index.generateId", prefix, () => native.generateId(prefix))
  }
}
