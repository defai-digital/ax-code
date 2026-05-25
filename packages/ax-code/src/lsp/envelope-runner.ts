import { Log } from "../util/log"
import { toErrorMessage } from "../util/error-message"
import type { LSPClient } from "./client"
import { participantStatus, type SemanticEnvelope } from "./envelope"
import * as LSPPerf from "./perf"
import { LspScheduler } from "./scheduler"
import type { ClientOptions, ClientSelection } from "./selection"

const log = Log.create({ service: "lsp" })

const LSP_ERROR_METHOD_NOT_FOUND = -32601

export function isMethodNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const code = (err as { code?: unknown }).code
  return code === LSP_ERROR_METHOD_NOT_FOUND
}

export async function runAll<T>(
  clients: LSPClient.Info[],
  input: (client: LSPClient.Info) => Promise<T>,
): Promise<T[]> {
  const tasks = clients.map((client) =>
    input(client).catch((err) => {
      log.warn("LSP client failed in runAll", { serverID: client.serverID, err })
      return undefined
    }),
  )
  return (await Promise.all(tasks)).filter((result): result is Awaited<T> => result !== undefined) as T[]
}

export async function runWithEnvelope<TClient, TPayload>(input: {
  file: string
  call: (client: LSPClient.Info) => Promise<TClient>
  reduce: (results: TClient[]) => TPayload
  empty: TPayload
  operation: string
  dedupKey?: string
  opts?: ClientOptions
  selectClients: (file: string, opts: ClientOptions) => Promise<ClientSelection>
}): Promise<SemanticEnvelope<TPayload>> {
  if (input.dedupKey) {
    return LspScheduler.Inflight.run(input.dedupKey, () => runWithEnvelopeUncollapsed(input))
  }
  return runWithEnvelopeUncollapsed(input)
}

async function runWithEnvelopeUncollapsed<TClient, TPayload>(input: {
  file: string
  call: (client: LSPClient.Info) => Promise<TClient>
  reduce: (results: TClient[]) => TPayload
  empty: TPayload
  operation: string
  opts?: ClientOptions
  selectClients: (file: string, opts: ClientOptions) => Promise<ClientSelection>
}): Promise<SemanticEnvelope<TPayload>> {
  const opts = input.opts ?? {}
  const selectStarted = performance.now()
  let selection: ClientSelection
  try {
    selection = await input.selectClients(input.file, opts)
  } catch (err) {
    LSPPerf.finishPhase(`${input.operation}.select`, selectStarted, false)
    throw err
  }
  const selectDurationMs = LSPPerf.finishPhase(`${input.operation}.select`, selectStarted, true)
  if (selection.freshSpawnCount > 0) {
    LSPPerf.recordSample(`${input.operation}.select.spawned`, selectDurationMs, true)
  }

  const clients = selection.clients
  if (clients.length === 0) {
    return {
      data: input.empty,
      source: "lsp",
      completeness: "empty",
      timestamp: Date.now(),
      serverIDs: [],
      degraded: false,
    }
  }

  let failures = 0
  const participatingServerIDs: string[] = []
  const rpcStarted = performance.now()
  let perClient: Array<TClient | undefined>
  try {
    perClient = await Promise.all(
      clients.map(async (client) => {
        let release: () => void
        try {
          release = await LspScheduler.Budget.acquire(client.serverID)
        } catch (err) {
          failures++
          log.warn("LSP budget acquire failed in runWithEnvelope", {
            serverID: client.serverID,
            err: toErrorMessage(err),
          })
          return undefined
        }
        try {
          const result = await input.call(client)
          participatingServerIDs.push(client.serverID)
          return result
        } catch (err) {
          if (isMethodNotFound(err)) return undefined
          failures++
          log.warn("LSP client failed in runWithEnvelope", { serverID: client.serverID, err })
          return undefined
        } finally {
          release()
        }
      }),
    )
    LSPPerf.finishPhase(`${input.operation}.rpc`, rpcStarted, failures === 0)
  } catch (err) {
    LSPPerf.finishPhase(`${input.operation}.rpc`, rpcStarted, false)
    throw err
  }

  const successful = perClient.filter((result): result is Awaited<TClient> => result !== undefined) as TClient[]
  const status = participantStatus({ participatingServerIDs, failures })
  return {
    data: input.reduce(successful),
    source: "lsp",
    completeness: status.completeness,
    timestamp: Date.now(),
    serverIDs: participatingServerIDs,
    degraded: status.degraded,
  }
}
