import type { Graph, GraphPort } from "../../src/host"

// In-memory GraphPort fake for engine tests.
//
// Symbols live in a plain Map keyed by id; caller/reference/dependent edges
// are adjacency lists the test configures directly. This makes cycles,
// missing nodes (phantom targets), and multi-caller fan-out trivial to
// express — the three graph shapes the engine's traversal logic must
// survive.
//
// Edge lookups resolve through the symbol map: an edge that points at an
// id with no symbol is skipped (the real graph cannot have dangling edges
// either — referential integrity is enforced at index time).

export type FakeSymbolInput = {
  id: string
  name?: string
  qualifiedName?: string
  kind?: Graph.NodeKind
  file?: string
  range?: Graph.Range
  signature?: string
  visibility?: string
  indexedAt?: number
  completeness?: Graph.Completeness
}

export type FakeGraph = {
  port: GraphPort
  symbols: Map<string, Graph.Symbol>
  addSymbol(input: FakeSymbolInput): Graph.Symbol
  /** Register `callerId` as a caller of `calleeId` (findCallers(calleeId) includes callerId). */
  addCallerEdge(calleeId: string, callerId: string): void
  addReference(symbolId: string, reference: Omit<Graph.Reference, "explain"> & { explain?: Graph.Explain }): void
  addDependent(file: string, dependent: string): void
  setStatus(
    overrides: Partial<Omit<Graph.Status, "projectID" | "revision">> & { revision?: Graph.Status["revision"] },
  ): void
}

let explainCounter = 0

function fakeExplain(indexedAt: number, completeness: Graph.Completeness): Graph.Explain {
  explainCounter += 1
  return {
    source: "code-graph",
    indexedAt,
    completeness,
    queryId: `test_query_${explainCounter}`,
  }
}

export function createFakeGraph(): FakeGraph {
  const symbols = new Map<string, Graph.Symbol>()
  const callers = new Map<string, string[]>()
  const references = new Map<string, Graph.Reference[]>()
  const dependents = new Map<string, string[]>()
  let statusOverrides: Partial<Graph.Status> = {}

  const fake: FakeGraph = {
    symbols,
    addSymbol(input) {
      const symbol: Graph.Symbol = {
        id: input.id,
        kind: input.kind ?? "function",
        name: input.name ?? input.id,
        qualifiedName: input.qualifiedName ?? input.id,
        file: input.file ?? `/repo/src/${input.id}.ts`,
        range: input.range ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
        explain: fakeExplain(input.indexedAt ?? 1000, input.completeness ?? "full"),
      }
      if (input.signature !== undefined) symbol.signature = input.signature
      if (input.visibility !== undefined) symbol.visibility = input.visibility
      symbols.set(symbol.id, symbol)
      return symbol
    },
    addCallerEdge(calleeId, callerId) {
      const list = callers.get(calleeId) ?? []
      list.push(callerId)
      callers.set(calleeId, list)
    },
    addReference(symbolId, reference) {
      const list = references.get(symbolId) ?? []
      list.push({ ...reference, explain: reference.explain ?? fakeExplain(1000, "full") })
      references.set(symbolId, list)
    },
    addDependent(file, dependent) {
      const list = dependents.get(file) ?? []
      list.push(dependent)
      dependents.set(file, list)
    },
    setStatus(overrides) {
      statusOverrides = { ...statusOverrides, ...overrides }
    },
    port: {
      findSymbol(_projectID, name, opts) {
        let hits = [...symbols.values()].filter((s) => s.name === name)
        if (opts?.file !== undefined) hits = hits.filter((s) => s.file === opts.file)
        if (opts?.kind !== undefined) hits = hits.filter((s) => s.kind === opts.kind)
        if (opts?.limit !== undefined) hits = hits.slice(0, opts.limit)
        return hits
      },
      findSymbolByPrefix(_projectID, prefix, opts) {
        let hits = [...symbols.values()].filter((s) => s.name.startsWith(prefix))
        if (opts?.kind !== undefined) hits = hits.filter((s) => s.kind === opts.kind)
        if (opts?.limit !== undefined) hits = hits.slice(0, opts.limit)
        return hits
      },
      getSymbol(_projectID, id) {
        return symbols.get(id) ?? null
      },
      symbolsInFile(_projectID, file) {
        return [...symbols.values()].filter((s) => s.file === file)
      },
      findCallers(_projectID, symbolId) {
        return (callers.get(symbolId) ?? [])
          .map((id) => symbols.get(id))
          .filter((s): s is Graph.Symbol => s !== undefined)
          .map((symbol) => ({ symbol, depth: 1 }))
      },
      findReferences(_projectID, symbolId) {
        return references.get(symbolId) ?? []
      },
      findDependents(_projectID, file) {
        return dependents.get(file) ?? []
      },
      status(projectID) {
        return {
          projectID,
          nodeCount: statusOverrides.nodeCount ?? symbols.size,
          edgeCount: statusOverrides.edgeCount ?? [...callers.values()].reduce((n, list) => n + list.length, 0),
          lastCommitSha: statusOverrides.lastCommitSha ?? null,
          lastUpdated: statusOverrides.lastUpdated ?? null,
          // Phase 2 (council decision 2): defaults to null when no
          // statusOverrides.revision is set. Tests can override to simulate
          // a derived graph revision hash.
          revision: statusOverrides.revision ?? null,
        }
      },
    },
  }
  return fake
}
