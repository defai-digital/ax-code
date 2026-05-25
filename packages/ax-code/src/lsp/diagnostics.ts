import type { LSPClient } from "./client"
import type { SemanticEnvelope } from "./envelope"
import * as LSPEnvelopeRunner from "./envelope-runner"
import * as LSPPerf from "./perf"

export type NormalizedSeverity = "error" | "warning" | "info" | "hint"

export type NormalizedDiagnostic = {
  path: string
  range: { start: { line: number; character: number }; end: { line: number; character: number } }
  severity: NormalizedSeverity
  message: string
  source?: string
  code?: string | number
  serverIDs: string[]
}

export type AggregateInput = {
  serverID: string
  diagnostics: Map<string, LSPClient.Diagnostic[]>
}

export async function collect(clients: LSPClient.Info[]): Promise<Record<string, LSPClient.Diagnostic[]>> {
  const results: Record<string, LSPClient.Diagnostic[]> = {}
  for (const result of await LSPEnvelopeRunner.runAll(clients, async (client) => client.diagnostics)) {
    for (const [path, diagnostics] of result.entries()) {
      const arr = results[path] || []
      arr.push(...diagnostics)
      results[path] = arr
    }
  }
  return results
}

export async function aggregateEnvelope(
  clients: LSPClient.Info[],
  file?: string,
): Promise<SemanticEnvelope<NormalizedDiagnostic[]>> {
  return LSPPerf.metered("diagnosticsAggregated", file ? { file } : {}, async () =>
    aggregate(
      clients.map((client) => ({ serverID: client.serverID, diagnostics: client.diagnostics })),
      { file, now: Date.now() },
    ),
  )
}

export function normalizeSeverity(s: number | undefined): NormalizedSeverity {
  // VSCode protocol: 1=error, 2=warning, 3=info, 4=hint. Missing severity is
  // client-interpretable, so keep it neutral instead of escalating it.
  if (s === 1) return "error"
  if (s === 2) return "warning"
  if (s === 3) return "info"
  if (s === 4) return "hint"
  return "info"
}

function dedupKeyOf(path: string, d: LSPClient.Diagnostic): string {
  const r = d.range
  return [path, r.start.line, r.start.character, r.end.line, r.end.character, d.message].join("\u0000")
}

export function aggregate(
  inputs: AggregateInput[],
  opts: { file?: string; now: number },
): SemanticEnvelope<NormalizedDiagnostic[]> {
  if (inputs.length === 0) {
    return {
      data: [],
      source: "lsp",
      completeness: "empty",
      timestamp: opts.now,
      serverIDs: [],
      degraded: false,
    }
  }

  const byKey = new Map<string, { d: LSPClient.Diagnostic; path: string; serverIDs: string[] }>()
  const participatingServerIDs = new Set<string>()

  for (const { serverID, diagnostics: map } of inputs) {
    let contributed = false
    const entries = opts.file ? (map.has(opts.file) ? ([[opts.file, map.get(opts.file)!]] as const) : []) : map.entries()
    for (const [path, diags] of entries) {
      for (const d of diags) {
        const key = dedupKeyOf(path, d)
        const existing = byKey.get(key)
        if (existing) {
          if (!existing.serverIDs.includes(serverID)) existing.serverIDs.push(serverID)
        } else {
          byKey.set(key, { d, path, serverIDs: [serverID] })
        }
        contributed = true
      }
    }
    if (contributed) participatingServerIDs.add(serverID)
  }

  const data: NormalizedDiagnostic[] = [...byKey.values()].map(({ d, path, serverIDs }) => ({
    path,
    range: d.range,
    severity: normalizeSeverity(d.severity),
    message: d.message,
    source: d.source,
    code: d.code,
    serverIDs,
  }))

  data.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1
    if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line
    if (a.range.start.character !== b.range.start.character) return a.range.start.character - b.range.start.character
    return a.message < b.message ? -1 : a.message > b.message ? 1 : 0
  })

  return {
    data,
    source: "lsp",
    completeness: participatingServerIDs.size === 0 ? "empty" : "full",
    timestamp: opts.now,
    serverIDs: [...participatingServerIDs],
    degraded: false,
  }
}
