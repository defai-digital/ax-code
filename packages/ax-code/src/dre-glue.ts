// Core glue for @ax-code/ax-code-reason.
//
// Wires the ax-code runtime (code-intelligence graph, shard-aware database,
// project instance context, bus, native addons) into the engine's host
// port. Importing this module configures the package; all host members
// are lazy, so the import itself is side-effect free beyond event
// registration.
//
// The correlated-diagnostics bus event is (re)defined here through
// BusEvent.define — reusing the package's zod schema so the shapes cannot
// drift — keeping the event registered in the core event registry for the
// SSE/OpenAPI contract.
//
// Phase 2 (D2, E3): the old drizzle handle (`db: DreDbPort`) is gone.
// Persistence is now two narrow repositories (`stores: { plans,
// embeddings }`) wired from src/dre/repositories.ts. The package has no
// drizzle types in its `src/` (only the schema DSL in `schema.sql.ts`,
// which the core drizzle impl reads via the `./schema.sql` subpath).
//
// New host members added in Phase 2:
//   - `sourceState` — worktree fingerprint (council decision 1) for
//     envelope freshness classification. Backed by `currentSourceState`
//     in `quality/source-state.ts` (Phase 1 deliverable).
//   - `graphRevision` — derived graph revision hash from
//     `CodeIntelligence.status(projectID).revision` (council decision 2).
//   - `clock` — wall-clock accessor for DRE timestamps.
//   - `abort` — stable per-instance AbortSignal for long-running
//     entrypoints that don't get an explicit signal from the caller.

import { configureCodeReasonHost, DebugEngine, type GraphPort, type CodeReasonHost } from "@ax-code/ax-code-reason"
import { setLogSink } from "@ax-code/ax-code-reason/log"
import { createEmbeddingRepository, createPlanRepository } from "@/dre/repositories"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { CodeIntelligence } from "@/code-intelligence"
import type { CodeNodeID } from "@/code-intelligence/id"
import { Flag } from "@/flag/flag"
import { Instance } from "@/project/instance"
import type { ProjectID } from "@/project/schema"
import { LspEvent } from "@/lsp-glue"
import { NativeAddon } from "@/native/addon"
import { NativePerf } from "@/perf/native"
import { Shell } from "@/shell/shell"
import { Database } from "@/storage/db"
import { Log } from "@/util/log"
import { currentSourceState } from "@/quality/source-state"

export const DreEvent = {
  CorrelatedDiagnostics: BusEvent.define(
    DebugEngine.Event.CorrelatedDiagnostics.type,
    DebugEngine.Event.CorrelatedDiagnostics.properties,
  ),
}

// Route package log output into the core log stack. Without a sink the
// standalone package writes to stderr, which corrupts compatible-mode TUI
// rendering and bypasses the configured AX Code log destination.
const loggerCache = new Map<string, ReturnType<typeof Log.create>>()
setLogSink((level, service, message, extra) => {
  let logger = loggerCache.get(service)
  if (!logger) {
    logger = Log.create({ service })
    loggerCache.set(service, logger)
  }
  logger[level](message, extra)
})

// Graph adapter: the engine speaks plain-string IDs across the port; the
// core graph uses branded ProjectID/CodeNodeID. Convert at the boundary.
const graph: GraphPort = {
  findSymbol: (projectID, name, opts) => CodeIntelligence.findSymbol(projectID as ProjectID, name, opts as any),
  findSymbolByPrefix: (projectID, prefix, opts) =>
    CodeIntelligence.findSymbolByPrefix(projectID as ProjectID, prefix, opts as any),
  getSymbol: (projectID, id, opts) => CodeIntelligence.getSymbol(projectID as ProjectID, id as CodeNodeID, opts),
  symbolsInFile: (projectID, file, opts) => CodeIntelligence.symbolsInFile(projectID as ProjectID, file, opts),
  findCallers: (projectID, symbolId, opts) =>
    CodeIntelligence.findCallers(projectID as ProjectID, symbolId as CodeNodeID, opts),
  findReferences: (projectID, symbolId, opts) =>
    CodeIntelligence.findReferences(projectID as ProjectID, symbolId as CodeNodeID, opts),
  findDependents: (projectID, file, opts) => CodeIntelligence.findDependents(projectID as ProjectID, file, opts),
  status: (projectID) => CodeIntelligence.status(projectID as ProjectID),
}

// Narrow repository wiring (Phase 2 D2): one PlanRepository + one
// EmbeddingRepository per process. They live behind the host's `stores`
// facade; engine code only sees the engine-typed interface.
const stores = {
  plans: createPlanRepository(),
  embeddings: createEmbeddingRepository(),
}

// Stable per-instance AbortSignal (council decision 10). Hosts need a
// single switch so a test fixture can flip cancellation without leaking
// process-wide AbortControllers. Long-running engine entrypoints default
// to this signal when the caller didn't pass one.
const abortController = new AbortController()
const hostSignal = abortController.signal

configureCodeReasonHost({
  projectID: () => Instance.project.id,
  projectRoot: () => Instance.directory,
  worktreeRoot: () => Instance.worktree,
  projectVcs: () => Instance.project.vcs ?? "none",
  containsPath: (path) => Instance.containsPath(path),
  flags: () => ({
    nativeScan: Flag.AX_CODE_DEBUG_ENGINE_NATIVE_SCAN,
  }),
  graph,
  stores,
  events: {
    subscribeClientDiagnostics: (callback) =>
      Bus.subscribe(LspEvent.ClientDiagnostics, (event) => {
        callback({ serverID: event.properties.serverID, path: event.properties.path })
      }),
    publishCorrelatedDiagnostics: (payload) => Bus.publishDetached(DreEvent.CorrelatedDiagnostics, payload),
  },
  native: {
    fs: () => NativeAddon.fs(),
    perfRun: (name, meta, fn) => NativePerf.run(name, meta, fn),
  },
  killTree: (proc, opts) => Shell.killTree(proc, opts),
  state: (init, dispose) => Instance.state(init, dispose),
  bind: (fn) => Instance.bind(fn),
  sourceState: () => currentSourceState(Instance.worktree, Instance.project.vcs ?? ""),
  graphRevision: () => {
    // Pull the derived revision hash from CodeIntelligence.status — the
    // same status the engine already consults for lastCommitSha, so the
    // classification stays single-sourced. Returns null when the cursor
    // is missing (fresh project) — that's the documented "fall back to
    // full analysis" signal.
    try {
      return CodeIntelligence.status(Instance.project.id).revision
    } catch {
      return null
    }
  },
  clock: () => Date.now(),
  abort: () => hostSignal,
})

// Re-export the type for callers that want to typecheck the host they
// build (and for the abort controller, in case tool code wants to flip
// the host signal for a coordinated cancel).
export type { CodeReasonHost }
export const dreAbortController = abortController
// `Database` import kept for jest/electron preload consumers — some
// legacy callers reach into the storage layer through this module.
export { Database }
