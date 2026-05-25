import * as LSPCacheProbe from "./cache-probe"
import type { SemanticEnvelope } from "./envelope"
import * as LSPPerf from "./perf"
import * as LSPPoint from "./point"
import type { ClientOptions, ClientSelection } from "./selection"

type SelectClients = (file: string, opts: ClientOptions) => Promise<ClientSelection>

export async function cachedEnvelope(input: LSPPoint.PointInput): Promise<SemanticEnvelope<unknown[]> | undefined> {
  return LSPCacheProbe.hashAndRead<unknown[]>({
    operation: "references",
    filePath: input.file,
    line: input.line,
    character: input.character,
    metric: "references.cached",
  })
}

export async function envelope(
  input: LSPPoint.PointInput & {
    cache?: boolean
  },
  opts: {
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<unknown[]>> {
  return LSPPerf.metered("references", { file: input.file }, async () => {
    return LSPCacheProbe.run<unknown[]>({
      operation: "references",
      filePath: input.file,
      line: input.line,
      character: input.character,
      cache: input.cache,
      cachedMetric: "references.cached",
      liveMetric: "references.live",
      execute: (dedupKey) =>
        LSPPoint.requestSemanticArrayEnvelope(input, {
          request: "textDocument/references",
          operation: "references",
          dedupKey,
          method: "references",
          extraParams: { context: { includeDeclaration: true } },
          timeoutMs: opts.timeoutMs,
          selectClients: opts.selectClients,
        }),
    })
  })
}
