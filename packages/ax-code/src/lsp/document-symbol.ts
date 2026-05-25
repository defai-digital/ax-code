import { fileURLToPath } from "url"
import { withTimeout } from "../util/timeout"
import * as LSPCacheProbe from "./cache-probe"
import type { SemanticEnvelope } from "./envelope"
import * as LSPEnvelopeRunner from "./envelope-runner"
import * as LSPPerf from "./perf"
import type { DocumentSymbol, Symbol } from "./protocol"
import type { ClientOptions, ClientSelection } from "./selection"

export type DocumentSymbolPayload = Array<DocumentSymbol | Symbol>

type SelectClients = (file: string, opts: ClientOptions) => Promise<ClientSelection>

export async function cachedEnvelope(uri: string): Promise<SemanticEnvelope<DocumentSymbolPayload> | undefined> {
  const file = fileURLToPath(uri)
  return LSPCacheProbe.hashAndRead<DocumentSymbolPayload>({
    operation: "documentSymbol",
    filePath: file,
    line: -1,
    character: -1,
    metric: "documentSymbol.cached",
  })
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
      execute: (dedupKey) =>
        LSPEnvelopeRunner.runWithEnvelope({
          file,
          call: (client) =>
            withTimeout(
              client.connection.sendRequest("textDocument/documentSymbol", {
                textDocument: { uri },
              }),
              opts.timeoutMs,
            ) as Promise<DocumentSymbolPayload>,
          reduce: (results) => results.flat().filter(Boolean) as DocumentSymbolPayload,
          empty: [] as DocumentSymbolPayload,
          operation: "documentSymbol",
          dedupKey,
          opts: { mode: "semantic", method: "documentSymbol" },
          selectClients: opts.selectClients,
        }),
    })
  })
}
