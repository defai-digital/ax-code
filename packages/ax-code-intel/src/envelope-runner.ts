import { Log } from "./internal/log"
import { toErrorMessage } from "./internal/error-message"
import type { LSPClient } from "./client"
import { participantStatus, type SemanticEnvelope } from "./envelope"
import * as LSPPerf from "./perf"
import { LspScheduler } from "./scheduler"
import type { ClientOptions, ClientSelection } from "./selection"
import { memoryWork } from "./memory-work"

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
  call: (client: LSPClient.Info, signal?: AbortSignal) => Promise<TClient>
  reduce: (results: TClient[]) => TPayload
  empty: TPayload
  operation: string
  dedupKey?: string
  opts?: ClientOptions
  selectClients: (file: string, opts: ClientOptions) => Promise<ClientSelection>
}): Promise<SemanticEnvelope<TPayload>> {
  if (input.dedupKey && !input.opts?.signal) {
    return LspScheduler.Inflight.run(input.dedupKey, () => runWithEnvelopeUncollapsed(input))
  }
  return runWithEnvelopeUncollapsed(input)
}

async function runWithEnvelopeUncollapsed<TClient, TPayload>(input: {
  file: string
  call: (client: LSPClient.Info, signal?: AbortSignal) => Promise<TClient>
  reduce: (results: TClient[]) => TPayload
  empty: TPayload
  operation: string
  opts?: ClientOptions
  selectClients: (file: string, opts: ClientOptions) => Promise<ClientSelection>
}): Promise<SemanticEnvelope<TPayload>> {
  const opts = input.opts ?? {}
  opts.signal?.throwIfAborted()
  const selectStarted = performance.now()
  let selection: ClientSelection
  try {
    selection = await input.selectClients(input.file, opts)
    opts.signal?.throwIfAborted()
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

  const rpcStarted = performance.now()
  const outcomes = await Promise.all(
    clients.map(async (client) => {
      const releaseWaiting = client.activity?.retain()
      try {
        return await memoryWork(
          "semantic",
          async (signal) => {
            // The queue can reject its caller before an uncooperative RPC settles.
            // Keep the client pinned for that entire underlying operation.
            const releaseRunning = client.activity?.retain()
            let releaseBudget: (() => void) | undefined
            try {
              releaseBudget = await LspScheduler.Budget.acquire(client.serverID)
              signal?.throwIfAborted()
              const result = await input.call(client, signal)
              signal?.throwIfAborted()
              return { result, failed: false, serverID: client.serverID }
            } catch (err) {
              if (isMethodNotFound(err)) return { result: undefined, failed: false }
              throw err
            } finally {
              releaseBudget?.()
              releaseRunning?.()
            }
          },
          opts.signal,
        )
      } catch (err) {
        opts.signal?.throwIfAborted()
        log.warn("LSP client failed in runWithEnvelope", { serverID: client.serverID, err: toErrorMessage(err) })
        return { result: undefined, failed: true }
      } finally {
        releaseWaiting?.()
      }
    }),
  ).catch((error) => {
    LSPPerf.finishPhase(`${input.operation}.rpc`, rpcStarted, false)
    throw error
  })
  const failures = outcomes.filter((outcome) => outcome.failed).length
  LSPPerf.finishPhase(`${input.operation}.rpc`, rpcStarted, failures === 0)
  const participatingServerIDs = outcomes.flatMap((outcome) => (outcome.serverID ? [outcome.serverID] : []))
  const successful = outcomes
    .map((outcome) => outcome.result)
    .filter((value): value is Awaited<TClient> => value !== undefined)
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
