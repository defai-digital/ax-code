import { CodeGraphQuery } from "../code-intelligence/query"
import type { LspCacheID } from "../code-intelligence/id"
import type { LspCacheOperation } from "../code-intelligence/schema.sql"
import { Flag } from "../flag/flag"
import { Instance } from "../project/instance"
import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import { hash as bunCompatHash } from "../bun/node-compat"
import { readFile } from "fs/promises"

export namespace LSPCache {
  const log = Log.create({ service: "lsp.cache" })

  export type Envelope<T> = {
    data: T
    source: "cache"
    completeness: "full" | "partial" | "empty"
    timestamp: number
    serverIDs: string[]
    cacheKey?: string
    degraded?: boolean
  }

  export type WritableEnvelope = {
    data: unknown
    completeness: "full" | "partial" | "empty"
    serverIDs: string[]
  }

  const TTL_MS = 24 * 60 * 60 * 1000
  const PRUNE_PROBABILITY = 0.01

  // Hit counts only bias prune ordering, so they don't need to be
  // durable per lookup. Accumulate them in memory and flush in one
  // transaction instead of paying a SQLite write on every cache hit.
  // Counts pending at process exit are lost, which is acceptable.
  const pendingHits = new Map<string, number>()
  let pendingHitTotal = 0
  const HIT_FLUSH_THRESHOLD = 32

  function recordHit(id: string) {
    pendingHits.set(id, (pendingHits.get(id) ?? 0) + 1)
    pendingHitTotal += 1
    if (pendingHitTotal >= HIT_FLUSH_THRESHOLD) flushHits()
  }

  function flushHits() {
    if (pendingHits.size === 0) return
    const entries = [...pendingHits.entries()] as [LspCacheID, number][]
    pendingHits.clear()
    pendingHitTotal = 0
    try {
      CodeGraphQuery.incrementLspCacheHits(entries)
    } catch {
      // Hit-count failure is not worth failing the request over.
    }
  }

  export function enabled(override?: boolean): boolean {
    return override ?? Flag.AX_CODE_LSP_CACHE
  }

  export function shouldWrite(envelope: WritableEnvelope, enabled: boolean) {
    return enabled && envelope.completeness === "full"
  }

  export async function hashFile(file: string): Promise<string | undefined> {
    try {
      // Keep the Bun-compatible hash format for cache entries written by older versions.
      const content = await readFile(file)
      return bunCompatHash(content).toString()
    } catch (err) {
      log.warn("cache: failed to hash file; skipping cache", { file, err: toErrorMessage(err) })
      return undefined
    }
  }

  export function lookup<T>(input: {
    operation: LspCacheOperation
    filePath: string
    contentHash: string
    line: number
    character: number
    enabled: boolean
  }): Envelope<T> | undefined {
    if (!input.enabled) return undefined
    let row: ReturnType<typeof CodeGraphQuery.getLspCache>
    try {
      row = CodeGraphQuery.getLspCache({
        projectID: Instance.project.id,
        operation: input.operation,
        filePath: input.filePath,
        contentHash: input.contentHash,
        line: input.line,
        character: input.character,
        now: Date.now(),
      })
    } catch (err) {
      log.warn("cache: lookup failed", { err: toErrorMessage(err) })
      return undefined
    }
    if (!row) return undefined

    recordHit(row.id)

    return {
      data: row.payload_json as T,
      source: "cache",
      completeness: row.completeness,
      timestamp: row.time_created,
      serverIDs: row.server_ids_json,
      cacheKey: row.id,
      degraded: false,
    }
  }

  export function write(input: {
    operation: LspCacheOperation
    filePath: string
    contentHash: string
    line: number
    character: number
    envelope: WritableEnvelope
    enabled: boolean
  }) {
    if (!input.enabled) return
    if (input.envelope.completeness !== "full") return

    // A write is already paying for a DB round-trip, so piggyback any
    // pending hit-count updates on it.
    flushHits()

    const now = Date.now()
    try {
      CodeGraphQuery.upsertLspCache({
        projectID: Instance.project.id,
        operation: input.operation,
        filePath: input.filePath,
        contentHash: input.contentHash,
        line: input.line,
        character: input.character,
        payload: input.envelope.data,
        serverIDs: input.envelope.serverIDs,
        completeness: input.envelope.completeness,
        expiresAt: now + TTL_MS,
      })
    } catch (err) {
      log.warn("cache: write failed", { err: toErrorMessage(err) })
      return
    }

    if (Math.random() < PRUNE_PROBABILITY) {
      try {
        const removed = CodeGraphQuery.pruneExpiredLspCache(now)
        if (removed > 0) log.info("cache: pruned expired rows", { removed })
      } catch (err) {
        log.warn("cache: prune failed", { err: toErrorMessage(err) })
      }
    }
  }
}
