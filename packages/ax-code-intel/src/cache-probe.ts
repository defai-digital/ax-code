import { codeIntelHostMaybe } from "./host"
import type { LspCacheStore } from "./host"
import type { SemanticEnvelope } from "./envelope"
import * as LSPCacheContext from "./cache-context"
import * as LSPPerf from "./perf"
import { Filesystem } from "./internal/filesystem"

type CacheProbeOperation = "documentSymbol" | "references"

export interface CacheProbeInput {
  operation: CacheProbeOperation
  filePath: string
  contentHash: string
  line: number
  character: number
  metric: string
}

function inflightKey(input: Omit<CacheProbeInput, "metric">): string {
  const base = `${input.operation}:${input.filePath}:${input.contentHash}`
  if (input.line < 0 || input.character < 0) return base
  return `${base}:${input.line}:${input.character}`
}

// The result cache is an optional host capability (in ax-code it is backed by
// the code-intelligence graph database). Without a configured cache store the
// probe degrades to always-live lookups.
function cacheStore() {
  return codeIntelHostMaybe()?.cacheStore
}

// The store sees `<context>#<content-hash>` as an opaque key. The context
// prefix (server/config fingerprint, plus the workspace generation for
// workspace-dependent operations) keeps entries from being reused after the
// server environment, the LSP configuration, or the rest of the workspace
// changed underneath them — a content-only key would happily return those
// stale results.
async function scopedContentHash(
  store: LspCacheStore,
  operation: CacheProbeOperation,
  filePath: string,
): Promise<string | undefined> {
  const raw = await store.hashFile(filePath)
  if (!raw) return undefined
  return LSPCacheContext.scopedHash(operation, raw)
}

// Dedup key for the cache-disabled path, built from file metadata instead of
// a content hash. Weaker than a hash (a same-size rewrite within one mtime
// tick slips through) but cheap: no file read.
async function statDedupKey(input: Omit<CacheProbeInput, "metric" | "contentHash">): Promise<string | undefined> {
  const stat = Filesystem.stat(input.filePath)
  if (!stat) return undefined
  return inflightKey({ ...input, contentHash: `${stat.mtimeMs}:${stat.size}` })
}

export function read<T>(input: CacheProbeInput, enabled?: boolean): SemanticEnvelope<T> | undefined {
  const store = cacheStore()
  if (!store) return undefined
  const hit = store.lookup<T>({
    operation: input.operation,
    filePath: input.filePath,
    contentHash: input.contentHash,
    line: input.line,
    character: input.character,
    enabled: enabled ?? store.enabled(),
  })
  if (hit) LSPPerf.recordSample(input.metric, 0, true)
  return hit
}

export async function hashAndRead<T>(
  input: Omit<CacheProbeInput, "contentHash">,
): Promise<SemanticEnvelope<T> | undefined> {
  const store = cacheStore()
  // Check enabled before hashing: with the cache disabled the file read is
  // pure I/O waste.
  if (!store || !store.enabled()) return undefined
  const contentHash = await scopedContentHash(store, input.operation, input.filePath)
  if (!contentHash) return undefined
  return read<T>(
    {
      ...input,
      contentHash,
    },
    true,
  )
}

export async function run<T>(input: {
  operation: CacheProbeOperation
  filePath: string
  line: number
  character: number
  cache?: boolean
  cachedMetric: string
  liveMetric: string
  execute: (dedupKey?: string) => Promise<SemanticEnvelope<T>>
  normalize?: (value: unknown) => T
}): Promise<SemanticEnvelope<T>> {
  const store = cacheStore()
  const enabled = store ? store.enabled(input.cache) : false
  // The content hash keys cache entries, so only pay for it (a full file
  // read) when the cache is enabled. contentHash implies enabled below.
  const contentHash = store && enabled ? await scopedContentHash(store, input.operation, input.filePath) : undefined

  if (store && contentHash) {
    const hit = read<T>(
      {
        operation: input.operation,
        filePath: input.filePath,
        contentHash,
        line: input.line,
        character: input.character,
        metric: input.cachedMetric,
      },
      enabled,
    )
    if (hit) {
      return input.normalize
        ? {
            ...hit,
            data: input.normalize(hit.data),
          }
        : hit
    }
  }

  const executed = await input.execute(
    contentHash
      ? inflightKey({
          operation: input.operation,
          filePath: input.filePath,
          contentHash,
          line: input.line,
          character: input.character,
        })
      : // Cache disabled: still collapse concurrent identical requests, keyed
        // by mtime+size so an edit between leader and follower never joins
        // them onto a stale result.
        await statDedupKey(input),
  )
  const envelope = input.normalize
    ? {
        ...executed,
        data: input.normalize(executed.data),
      }
    : executed

  LSPPerf.recordSample(input.liveMetric, 0, true)
  if (store && contentHash) {
    store.write({
      operation: input.operation,
      filePath: input.filePath,
      contentHash,
      line: input.line,
      character: input.character,
      envelope,
      enabled,
    })
  }
  return envelope
}
