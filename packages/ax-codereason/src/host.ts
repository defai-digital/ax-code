// Host port for @ax-code/ax-codereason.
//
// The package is a deterministic debugging & refactoring reasoning engine on
// top of a code graph. It must not depend on the ax-code core, so everything
// environment-specific — the graph implementation, database access, project
// context, event bus, native scanner addons — is injected through this port.
// The ax-code core wires a concrete implementation at boot (src/dre-glue.ts);
// future projects provide their own.
//
// configureCodeReasonHost() must be called once before any engine API is used.
// All members are lazy (getters/functions), so the host can serve multiple
// workspaces over its lifetime.

import type { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite"
import type { SQLiteTransaction } from "drizzle-orm/sqlite-core"
import type { StatementResultingChanges } from "node:sqlite"

// ─── Graph contract ─────────────────────────────────────────────────────
//
// Structural mirror of the code-intelligence result shapes. IDs cross the
// port as plain strings; hosts with branded ID types convert at the adapter
// boundary.

export namespace Graph {
  export type Completeness = "full" | "partial" | "lsp-only"

  export type Explain = {
    source: "code-graph"
    indexedAt: number
    completeness: Completeness
    queryId: string
  }

  export type NodeKind =
    | "function"
    | "method"
    | "class"
    | "interface"
    | "type"
    | "variable"
    | "constant"
    | "module"
    | "parameter"
    | "enum"

  export type EdgeKind = "calls" | "references" | "imports" | "extends" | "implements" | "defines" | "declared_in"

  export type Position = { line: number; character: number }
  export type Range = { start: Position; end: Position }

  export type Symbol = {
    id: string
    kind: NodeKind
    name: string
    qualifiedName: string
    file: string
    range: Range
    signature?: string
    visibility?: string
    explain: Explain
  }

  export type Reference = {
    sourceFile: string
    range: Range
    edgeKind: EdgeKind
    explain: Explain
  }

  export type CallChainNode = {
    symbol: Symbol
    depth: number
  }

  // "worktree" drops rows outside the active worktree; "none" is raw.
  export type Scope = "worktree" | "none"

  export type QueryOpts = { scope?: Scope }

  export type Status = {
    projectID: string
    nodeCount: number
    edgeCount: number
    lastCommitSha: string | null
    lastUpdated: number | null
  }
}

export type GraphPort = {
  findSymbol(
    projectID: string,
    name: string,
    opts?: Graph.QueryOpts & { kind?: string; file?: string; limit?: number },
  ): Graph.Symbol[]
  findSymbolByPrefix(
    projectID: string,
    prefix: string,
    opts?: Graph.QueryOpts & { kind?: string; limit?: number },
  ): Graph.Symbol[]
  getSymbol(projectID: string, id: string, opts?: Graph.QueryOpts): Graph.Symbol | null
  symbolsInFile(projectID: string, file: string, opts?: Graph.QueryOpts): Graph.Symbol[]
  findCallers(projectID: string, symbolId: string, opts?: Graph.QueryOpts): Graph.CallChainNode[]
  findReferences(projectID: string, symbolId: string, opts?: Graph.QueryOpts): Graph.Reference[]
  findDependents(projectID: string, file: string, opts?: Graph.QueryOpts): string[]
  status(projectID: string): Graph.Status
}

// ─── Storage contract ───────────────────────────────────────────────────
//
// The engine persists refactor plans, pattern memory, and debug-case state
// in its own tables (debug_engine_*). The host provides a drizzle handle —
// typically the core's shard-aware Database.use/transaction.

export type DreDb = NodeSQLiteDatabase
export type DreTx = SQLiteTransaction<"sync", StatementResultingChanges>
export type DreTxOrDb = DreTx | DreDb

export type DreDbPort = {
  use<T>(callback: (trx: DreTxOrDb) => T): T
  transaction<T>(callback: (trx: DreTxOrDb) => T): T
}

// ─── Event contract ─────────────────────────────────────────────────────

export type DiagnosticEvent = { serverID: string; path: string }

export type CorrelatedDiagnostic = {
  file: string
  line: number
  message: string
  severity: number
  rootCauseFile: string | null
  rootCauseSymbol: string | null
  rootCauseChain: string[]
  confidence: "high" | "medium" | "low"
  lspTimestamp: number
  lspServerIDs: string[]
  graphQueryIds: string[]
  graphIndexedAt: number
  graphCompleteness: Graph.Completeness
}

export type CorrelatedDiagnosticsPayload = {
  file: string
  correlations: CorrelatedDiagnostic[]
}

export type DreEventsPort = {
  // Subscribe to LSP client diagnostics events (emitted by language servers
  // through ax-codeintel). Returns an unsubscribe function.
  subscribeClientDiagnostics(callback: (event: DiagnosticEvent) => void): () => void
  // Publish correlated-diagnostics results on the host's event bus. The host
  // registers the event definition with its own bus so it appears in event
  // contracts (e.g. SSE/OpenAPI).
  publishCorrelatedDiagnostics(payload: CorrelatedDiagnosticsPayload): void
}

// ─── Native scanner contract (optional) ─────────────────────────────────

export type DreNativePort = {
  // The native filesystem addon API, or undefined when unavailable.
  fs(): unknown | undefined
  // Run a callable under the host's native perf sampler.
  perfRun<T>(name: string, meta: Record<string, unknown>, fn: () => T): T
}

// ─── Host ───────────────────────────────────────────────────────────────

export type KillableProcess = {
  pid?: number
  kill: (signal?: NodeJS.Signals | number) => boolean | void
}

export type CodeReasonHost = {
  // Active project identity and workspace geometry.
  projectID(): string
  projectRoot(): string
  worktreeRoot(): string
  // VCS kind of the active project (e.g. "git").
  projectVcs(): string
  // Whether a path lies within the project boundary (root or worktree).
  containsPath(path: string): boolean
  flags(): {
    nativeScan: boolean
  }
  graph: GraphPort
  db: DreDbPort
  events: DreEventsPort
  native?: DreNativePort
  killTree(proc: KillableProcess, opts?: { exited?: () => boolean; signal?: NodeJS.Signals | number }): Promise<void>
  // Per-workspace memoized state container (init runs once per workspace).
  state<S>(
    init: () => S,
    dispose?: (state: Awaited<S>) => Promise<void>,
  ): (() => S) & { invalidate: () => Promise<void> }
  // Capture the current host context and rebind it inside a callback that
  // fires outside it (timers, event handlers).
  bind<F extends (...args: any[]) => any>(fn: F): F
}

let current: CodeReasonHost | undefined

export function configureCodeReasonHost(host: CodeReasonHost): void {
  current = host
}

export function codeReasonHost(): CodeReasonHost {
  if (!current) {
    throw new Error(
      "@ax-code/ax-codereason is not configured: call configureCodeReasonHost() before using the engine API",
    )
  }
  return current
}

export function codeReasonHostMaybe(): CodeReasonHost | undefined {
  return current
}
