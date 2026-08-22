import { fileURLToPath } from "url"
import { withTimeout } from "./internal/timeout"
import * as LSPCacheProbe from "./cache-probe"
import type { SemanticEnvelope } from "./envelope"
import * as LSPEnvelopeRunner from "./envelope-runner"
import * as LSPPerf from "./perf"
import type { DocumentSymbol, Symbol } from "./protocol"
import type { ClientOptions, ClientSelection } from "./selection"
import { normalizeDocumentSymbols } from "./semantic-results"

export type DocumentSymbolPayload = Array<DocumentSymbol | Symbol>

type SelectClients = (file: string, opts: ClientOptions) => Promise<ClientSelection>

export async function cachedEnvelope(uri: string): Promise<SemanticEnvelope<DocumentSymbolPayload> | undefined> {
  const file = fileURLToPath(uri)
  const cached = await LSPCacheProbe.hashAndRead<unknown[]>({
    operation: "documentSymbol",
    filePath: file,
    line: -1,
    character: -1,
    metric: "documentSymbol.cached",
  })
  if (!cached) return undefined
  return {
    ...cached,
    data: normalizeDocumentSymbols(cached.data) as DocumentSymbolPayload,
  }
}

export async function envelope(
  uri: string,
  opts: {
    cache?: boolean
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<SemanticEnvelope<DocumentSymbolPayload>> {
  const file = fileURLToPath(uri)
  return LSPPerf.metered("documentSymbol", { file }, async () => {
    return LSPCacheProbe.run<DocumentSymbolPayload>({
      operation: "documentSymbol",
      filePath: file,
      line: -1,
      character: -1,
      cache: opts.cache,
      cachedMetric: "documentSymbol.cached",
      liveMetric: "documentSymbol.live",
      normalize: (value) => normalizeDocumentSymbols(value) as DocumentSymbolPayload,
      execute: (dedupKey) =>
        LSPEnvelopeRunner.runWithEnvelope({
          file,
          call: (client) =>
            withTimeout(
              client.connection.sendRequest("textDocument/documentSymbol", {
                textDocument: { uri },
              }),
              opts.timeoutMs,
            ) as Promise<unknown>,
          reduce: (results) => results.flatMap(normalizeDocumentSymbols) as DocumentSymbolPayload,
          empty: [] as DocumentSymbolPayload,
          operation: "documentSymbol",
          dedupKey,
          opts: { mode: "semantic", method: "documentSymbol" },
          selectClients: opts.selectClients,
        }),
    })
  })
}

export async function documentSymbols(
  uri: string,
  opts: {
    cache?: boolean
    timeoutMs: number
    selectClients: SelectClients
  },
): Promise<DocumentSymbolPayload> {
  return (await envelope(uri, opts)).data
}
