// Core glue for @ax-code/ax-code-reason.
//
// Wires the ax-code runtime (code-intelligence graph, shard-aware database,
// project instance context, bus, native addons) into the engine's host port.
// Importing this module configures the package; all host members are lazy,
// so the import itself is side-effect free beyond event registration.
//
// The correlated-diagnostics bus event is (re)defined here through
// BusEvent.define — reusing the package's zod schema so the shapes cannot
// drift — keeping the event registered in the core event registry for the
// SSE/OpenAPI contract.

import { configureCodeReasonHost, DebugEngine, type GraphPort } from "@ax-code/ax-code-reason"
import type { DreTxOrDb } from "@ax-code/ax-code-reason/host"
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

export const DreEvent = {
  CorrelatedDiagnostics: BusEvent.define(
    DebugEngine.Event.CorrelatedDiagnostics.type,
    DebugEngine.Event.CorrelatedDiagnostics.properties,
  ),
}

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
  db: {
    use: (callback) => Database.use(callback),
    // Database.transaction returns SyncTransactionResult<T> — a conditional
    // type that rejects async callbacks — which TS cannot equate with the
    // port's plain T for a generic callback. The runtime sync guard in
    // Database.transaction still applies.
    transaction: <T>(callback: (trx: DreTxOrDb) => T): T => Database.transaction(callback) as T,
  },
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
})
