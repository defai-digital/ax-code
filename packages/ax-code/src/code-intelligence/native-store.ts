import { Log } from "../util/log"
import { Global } from "../global"
import type { ProjectID } from "../project/schema"
import type { CodeNodeID, CodeEdgeID, CodeFileID } from "./id"
import type { CodeNodeKind, CodeEdgeKind } from "./schema.sql"

const log = Log.create({ service: "code-intelligence.native-store" })

// Dynamic import of the native addon — fails gracefully if not available
let native: any

try {
  native = require("@ax-code/index-core")
} catch {
  // Native addon not available — will fall back to Drizzle
}

let storeInstance: any | undefined

function getDbPath(): string {
  return Global.Path.data + "/ax-code-index.db"
}

function store(): any {
  if (!storeInstance && native) {
    try {
      storeInstance = new native.IndexStore(getDbPath())
    } catch (err) {
      log.warn("failed to initialize native IndexStore", { error: String(err) })
    }
  }
  return storeInstance
}

export namespace NativeStore {
  export const available = !!native

  // ─── Node operations ──────────────────────────────────────────────

  export function insertNodes(rows: any[]): void {
    store()?.insertNodes(JSON.stringify(rows))
  }

  export function getNode(projectID: ProjectID, id: CodeNodeID): any | undefined {
    const result = store()?.getNode(projectID, id)
    return result ? JSON.parse(result) : undefined
  }

  export function findNodesByName(projectID: ProjectID, name: string, opts?: { kind?: CodeNodeKind; file?: string; limit?: number }): any[] {
    const result = store()?.findNodesByName(projectID, name, JSON.stringify(opts ?? {}))
    return result ? JSON.parse(result) : []
  }

  export function findNodesByNamePrefix(projectID: ProjectID, prefix: string, opts?: { kind?: CodeNodeKind; limit?: number }): any[] {
    const result = store()?.findNodesByPrefix(projectID, prefix, JSON.stringify(opts ?? {}))
    return result ? JSON.parse(result) : []
  }

  export function nodesInFile(projectID: ProjectID, file: string): any[] {
    const result = store()?.nodesInFile(projectID, file)
    return result ? JSON.parse(result) : []
  }

  export function countNodes(projectID: ProjectID): number {
    return store()?.countNodes(projectID) ?? 0
  }

  export function deleteNodesInFile(projectID: ProjectID, file: string): void {
    store()?.deleteNodesInFile(projectID, file)
  }

  // ─── Edge operations ──────────────────────────────────────────────

  export function insertEdges(rows: any[]): void {
    store()?.insertEdges(JSON.stringify(rows))
  }

  export function edgesFrom(projectID: ProjectID, fromNode: CodeNodeID, kind?: CodeEdgeKind): any[] {
    const result = store()?.edgesFrom(projectID, fromNode, kind ?? null)
    return result ? JSON.parse(result) : []
  }

  export function edgesTo(projectID: ProjectID, toNode: CodeNodeID, kind?: CodeEdgeKind): any[] {
    const result = store()?.edgesTo(projectID, toNode, kind ?? null)
    return result ? JSON.parse(result) : []
  }

  export function edgesInFile(projectID: ProjectID, file: string): any[] {
    const result = store()?.edgesInFile(projectID, file)
    return result ? JSON.parse(result) : []
  }

  export function deleteEdgesTouchingFile(projectID: ProjectID, file: string): void {
    store()?.deleteEdgesTouchingFile(projectID, file)
  }

  export function countEdges(projectID: ProjectID): number {
    return store()?.countEdges(projectID) ?? 0
  }

  // ─── File operations ─────────��────────────────────────────────────

  export function upsertFile(row: any): void {
    store()?.upsertFile(JSON.stringify(row))
  }

  export function getFile(projectID: ProjectID, path: string): any | undefined {
    const result = store()?.getFile(projectID, path)
    return result ? JSON.parse(result) : undefined
  }

  export function listFiles(projectID: ProjectID): any[] {
    const result = store()?.listFiles(projectID)
    return result ? JSON.parse(result) : []
  }

  export function pruneOrphanFiles(projectID: ProjectID, livePaths: string[], scopePrefix: string): { files: number; nodes: number; edges: number } {
    const result = store()?.pruneOrphanFiles(projectID, JSON.stringify(livePaths), scopePrefix)
    return result ? JSON.parse(result) : { files: 0, nodes: 0, edges: 0 }
  }

  // ─── Cursor operations ──────���─────────────────────────────────────

  export function getCursor(projectID: ProjectID): any | undefined {
    const result = store()?.getCursor(projectID)
    return result ? JSON.parse(result) : undefined
  }

  export function upsertCursor(projectID: ProjectID, commitSha: string | null, nodeCount: number, edgeCount: number): void {
    store()?.upsertCursor(projectID, commitSha, nodeCount, edgeCount)
  }

  // ─── Project operations ──────────────���────────────────────────────

  export function clearProject(projectID: ProjectID): void {
    store()?.clearProject(projectID)
  }

  export function analyze(): void {
    store()?.analyze()
  }

  // ─── Atomic ingest ────���─────────────────────────────────��─────────

  export function ingestFile(projectID: ProjectID, filePath: string, nodes: any[], edges: any[], fileMeta: any): void {
    store()?.ingestFile(projectID, filePath, JSON.stringify(nodes), JSON.stringify(edges), JSON.stringify(fileMeta))
  }

  // ─── IntervalTree ─���───────────────────────────────────────────────

  export function createIntervalTree(): any | undefined {
    if (!native) return undefined
    return new native.IntervalTree()
  }

  // ─── Advisory Lock ─────────────────────────────────────���──────────

  export function createAdvisoryLock(lockPath: string): any | undefined {
    if (!native) return undefined
    return new native.AdvisoryLock(lockPath)
  }

  // ─── Hashing ──────────────────────────────────────────────────────

  export function hashSha256(data: Buffer): string | undefined {
    if (!native) return undefined
    return native.hashSha256(data)
  }

  // ─── ID Generation ────────────��───────────────────────────────────

  export function generateId(prefix: string): string | undefined {
    if (!native) return undefined
    return native.generateId(prefix)
  }
}
