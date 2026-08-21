import { codeIntelHostMaybe } from "./host"
import type { SemanticEnvelope } from "./envelope"
import * as LSPPerf from "./perf"

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

export function read<T>(input: CacheProbeInput): SemanticEnvelope<T> | undefined {
  const store = cacheStore()
  if (!store) return undefined
  const hit = store.lookup<T>({
    operation: input.operation,
    filePath: input.filePath,
    contentHash: input.contentHash,
    line: input.line,
    character: input.character,
    enabled: true,
  })
  if (hit) LSPPerf.recordSample(input.metric, 0, true)
  return hit
}

export async function hashAndRead<T>(
  input: Omit<CacheProbeInput, "contentHash">,
): Promise<SemanticEnvelope<T> | undefined> {
  const store = cacheStore()
  if (!store) return undefined
  const contentHash = await store.hashFile(input.filePath)
  if (!contentHash) return undefined
  return read<T>({
    ...input,
    contentHash,
  })
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
}): Promise<SemanticEnvelope<T>> {
  const store = cacheStore()
  const enabled = store ? store.enabled(input.cache) : false
  const contentHash = store ? await store.hashFile(input.filePath) : undefined

  if (contentHash && enabled) {
    const hit = read<T>({
      operation: input.operation,
      filePath: input.filePath,
      contentHash,
      line: input.line,
      character: input.character,
      metric: input.cachedMetric,
    })
    if (hit) return hit
  }

  const envelope = await input.execute(
    contentHash
      ? inflightKey({
          operation: input.operation,
          filePath: input.filePath,
          contentHash,
          line: input.line,
          character: input.character,
        })
      : undefined,
  )

  LSPPerf.recordSample(input.liveMetric, 0, true)
  if (store && contentHash && enabled) {
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
