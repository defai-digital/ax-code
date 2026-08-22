import * as LSPCacheProbe from "./cache-probe"
import type { SemanticEnvelope } from "./envelope"
import * as LSPPerf from "./perf"
import * as LSPPoint from "./point"
import type { ClientOptions, ClientSelection } from "./selection"
import { normalizeLocations } from "./semantic-results"
import type { Location } from "./semantic-results"

type SelectClients = (file: string, opts: ClientOptions) => Promise<ClientSelection>

export async function cachedEnvelope(input: LSPPoint.PointInput): Promise<SemanticEnvelope<Location[]> | undefined> {
  const cached = await LSPCacheProbe.hashAndRead<unknown[]>({
    operation: "references",
    filePath: input.file,
    line: input.line,
    character: input.character,
    metric: "references.cached",
  })
  if (!cached) return undefined
  return {
    ...cached,
    data: normalizeLocations(cached.data),
  }
}

export async function envelope(
  input: LSPPoint.PointInput & {
    cache?: boolean
  },
  opts: {
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<Location[]>> {
  return LSPPerf.metered("references", { file: input.file }, async () => {
    return LSPCacheProbe.run<Location[]>({
      operation: "references",
      filePath: input.file,
      line: input.line,
      character: input.character,
      cache: input.cache,
      cachedMetric: "references.cached",
      liveMetric: "references.live",
      normalize: normalizeLocations,
      execute: (dedupKey) =>
        LSPPoint.requestSemanticArrayEnvelope(input, {
          request: "textDocument/references",
          operation: "references",
          dedupKey,
          method: "references",
          normalize: normalizeLocations,
          extraParams: { context: { includeDeclaration: true } },
          timeoutMs: opts.timeoutMs,
          selectClients: opts.selectClients,
        }),
    })
  })
}

export async function references(
  input: LSPPoint.PointInput & {
    cache?: boolean
  },
  opts: {
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<Location[]> {
  return (await envelope(input, opts)).data
}
