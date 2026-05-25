import type { Symbol } from "./protocol"
import { participantStatus } from "./envelope"
import type { LSPClient } from "./client"
import { Log } from "../util/log"
import { withTimeout } from "../util/timeout"
import { isMethodNotFound } from "./envelope-runner"
import * as LSPPerf from "./perf"
import type { ClientOptions, ClientSelection } from "./selection"

const log = Log.create({ service: "lsp" })

export type SymbolEnvelope = {
  symbols: Symbol[]
  source: "lsp"
  completeness: "full" | "partial" | "empty"
  timestamp: number
  serverIDs: string[]
  degraded?: boolean
}

export type SymbolQueryResult = {
  envelope: SymbolEnvelope
  ok: boolean
}

type SelectWorkspaceClients = (opts: ClientOptions) => Promise<ClientSelection>

enum SymbolKind {
  Class = 5,
  Method = 6,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  Struct = 23,
}

const RELEVANT_KINDS = new Set<number>([
  SymbolKind.Class,
  SymbolKind.Function,
  SymbolKind.Method,
  SymbolKind.Interface,
  SymbolKind.Variable,
  SymbolKind.Constant,
  SymbolKind.Struct,
  SymbolKind.Enum,
])

export function isRelevant(symbol: Pick<Symbol, "kind">): boolean {
  return RELEVANT_KINDS.has(symbol.kind)
}

function dedupKey(symbol: Symbol): string {
  return [
    symbol.name,
    symbol.kind,
    symbol.location.uri,
    symbol.location.range.start.line,
    symbol.location.range.start.character,
    symbol.location.range.end.line,
    symbol.location.range.end.character,
  ].join(":")
}

export function dedupeAndLimit(symbols: Array<Symbol | undefined | null>, limit: number): Symbol[] {
  const seen = new Set<string>()
  const result: Symbol[] = []
  for (const symbol of symbols) {
    if (!symbol) continue
    const key = dedupKey(symbol)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(symbol)
    if (result.length >= limit) break
  }
  return result
}

export function completeness(input: { participatingServerIDs: string[]; failures: number }): {
  completeness: SymbolEnvelope["completeness"]
  degraded: boolean
} {
  return participantStatus(input)
}

export function emptyEnvelope(): SymbolEnvelope {
  return {
    symbols: [],
    source: "lsp",
    completeness: "empty",
    timestamp: Date.now(),
    serverIDs: [],
    degraded: false,
  }
}

export async function queryClients(input: {
  clients: LSPClient.Info[]
  query: string
  timeoutMs: number
  limit: number
}): Promise<SymbolQueryResult> {
  if (input.clients.length === 0) {
    return {
      envelope: emptyEnvelope(),
      ok: true,
    }
  }

  let failures = 0
  const participatingServerIDs: string[] = []
  const result = await Promise.all(
    input.clients.map((client) =>
      withTimeout(
        client.connection.sendRequest("workspace/symbol", {
          query: input.query,
        }),
        input.timeoutMs,
      )
        .then((result) => {
          participatingServerIDs.push(client.serverID)
          return (result as Symbol[]).filter(isRelevant)
        })
        .catch((err) => {
          // A linter LSP attached to the same file type may not implement
          // workspace/symbol. Treat MethodNotFound as "not participating",
          // not as a partial-completeness downgrade.
          if (!isMethodNotFound(err)) {
            failures++
            log.warn("LSP client failed in workspaceSymbol", { serverID: client.serverID, err })
          }
          return [] as Symbol[]
        }),
    ),
  )

  const status = completeness({ participatingServerIDs, failures })
  return {
    envelope: {
      symbols: dedupeAndLimit(result.flat(), input.limit),
      source: "lsp",
      completeness: status.completeness,
      timestamp: Date.now(),
      serverIDs: participatingServerIDs,
      degraded: status.degraded,
    },
    ok: failures === 0,
  }
}

export async function envelope(input: {
  query: string
  timeoutMs: number
  limit: number
  selectClients: SelectWorkspaceClients
}): Promise<SymbolEnvelope> {
  return LSPPerf.metered("workspaceSymbol", { query: input.query }, async () => {
    const selectStarted = performance.now()
    let selection: ClientSelection
    try {
      selection = await input.selectClients({ mode: "semantic", method: "workspaceSymbol" })
    } catch (err) {
      LSPPerf.finishPhase("workspaceSymbol.select", selectStarted, false)
      throw err
    }
    const selectDurationMs = LSPPerf.finishPhase("workspaceSymbol.select", selectStarted, true)
    if (selection.freshSpawnCount > 0) {
      LSPPerf.recordSample("workspaceSymbol.select.spawned", selectDurationMs, true)
    }

    if (selection.clients.length === 0) return emptyEnvelope()

    const rpcStarted = performance.now()
    let result: SymbolQueryResult
    try {
      result = await queryClients({
        clients: selection.clients,
        query: input.query,
        timeoutMs: input.timeoutMs,
        limit: input.limit,
      })
      LSPPerf.finishPhase("workspaceSymbol.rpc", rpcStarted, result.ok)
    } catch (err) {
      LSPPerf.finishPhase("workspaceSymbol.rpc", rpcStarted, false)
      throw err
    }
    return result.envelope
  })
}
