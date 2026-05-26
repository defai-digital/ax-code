import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { Shell } from "../shell/shell"
import { LSPClient } from "./client"
import path from "path"
import { LSPServer } from "./server"
import z from "zod"
import type { ChildProcessWithoutNullStreams } from "child_process"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Ripgrep } from "../file/ripgrep"
import { LspScheduler } from "./scheduler"
import * as LSPSelection from "./selection"
import * as LSPBrokenServer from "./broken-server"
import * as LSPPerf from "./perf"
import * as LSPPrewarm from "./prewarm"
import * as LSPEnvelope from "./envelope"
import * as LSPDiagnostics from "./diagnostics"
import * as LSPProtocol from "./protocol"
import * as LSPWorkspaceSymbol from "./workspace-symbol"
import * as LSPPoint from "./point"
import * as LSPClientNotify from "./client-notify"
import * as LSPDocumentSymbol from "./document-symbol"
import * as LSPReferences from "./references"
import { LSPServerConfig } from "./server-config"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  export type PerfRow = LSPPerf.PerfRow
  export const perfSnapshot = LSPPerf.snapshot
  export const perfReset = LSPPerf.reset
  export type SemanticEnvelope<T> = LSPEnvelope.SemanticEnvelope<T>
  export type Freshness = LSPEnvelope.Freshness
  export const envelopeFreshness = LSPEnvelope.freshness
  export type NormalizedSeverity = LSPDiagnostics.NormalizedSeverity
  export type NormalizedDiagnostic = LSPDiagnostics.NormalizedDiagnostic

  // Bound LSP RPC calls so a hung language server cannot block tool execution.
  // Pointwise queries get a short budget; workspace-wide queries get a longer
  // one because they may scan the entire project on first call.
  const RPC_TIMEOUT_MS = 5_000
  const RPC_TIMEOUT_LONG_MS = 15_000

  // How often the health-check loop runs. A dead-process probe is cheap
  // (kill -0 syscall), so we can run it frequently without concern. 60s is
  // responsive enough for interactive use without generating log noise.
  const HEALTH_CHECK_INTERVAL_MS = 60_000
  const MAX_ROOT_CACHE_ENTRIES = 2_000

  const hasProcessExited = (proc: ChildProcessWithoutNullStreams) => proc.exitCode !== null || proc.signalCode !== null

  async function stopLSPProcess(proc: ChildProcessWithoutNullStreams) {
    await Shell.killTree(proc, {
      exited: () => hasProcessExited(proc),
    })
  }

  function clientKey(root: string, serverID: string) {
    return `${root}\0${serverID}`
  }

  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export const Range = LSPProtocol.Range
  export type Range = LSPProtocol.Range
  export const Symbol = LSPProtocol.Symbol
  export type Symbol = LSPProtocol.Symbol
  export const DocumentSymbol = LSPProtocol.DocumentSymbol
  export type DocumentSymbol = LSPProtocol.DocumentSymbol

  export type ClientMode = LSPSelection.ClientMode
  type ClientOptions = LSPSelection.ClientOptions
  type PrewarmSelectionOptions = LSPSelection.PrewarmSelectionOptions
  type ClientSelection = LSPSelection.ClientSelection
  const requestedMethods = LSPSelection.requestedMethods
  const filterClientsForSelection = LSPSelection.filterClientsForSelection
  const resolveClientRequest = LSPSelection.resolveClientRequest
  const serverMatchesClientRequest = LSPSelection.serverMatchesClientRequest
  const serverSupportsFileExtension = LSPSelection.serverSupportsFileExtension
  const clientPrewarmMatchesServer = LSPSelection.clientPrewarmMatchesServer

  const state = Instance.state(
    async () => {
      const clients: LSPClient.Info[] = []
      const cfg = await Config.get()
      const servers = LSPServerConfig.buildEnabledServers(cfg)

      if (cfg.lsp === false) {
        log.info("all LSPs are disabled")
        return {
          broken: new Map<string, LSPBrokenServer.BrokenEntry>(),
          servers,
          clients,
          rootCache: new Map<string, string | null>(),
          spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
          healthCheck: undefined,
        }
      }

      for (const server of Object.values(servers)) {
        LspScheduler.Budget.setBudget(server.id, server.concurrency)
      }

      log.info("enabled LSP servers", {
        serverIds: Object.values(servers)
          .map((server) => server.id)
          .join(", "),
      })

      const s = {
        broken: new Map<string, LSPBrokenServer.BrokenEntry>(),
        servers,
        clients,
        rootCache: new Map<string, string | null>(),
        spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
        healthCheck: undefined as ReturnType<typeof setInterval> | undefined,
      }

      // Health-check loop: periodically probe every connected client and
      // remove any whose underlying process has died. Dead clients get
      // marked broken so the backoff keeps them from respawning immediately.
      // The interval is unref'd so ax-code can exit cleanly even if the
      // loop is in flight.
      s.healthCheck = setInterval(() => {
        if (s.clients.length === 0) return
        const dead: LSPClient.Info[] = []
        for (const client of s.clients) {
          if (!client.ping()) dead.push(client)
        }
        if (dead.length === 0) return
        for (const client of dead) {
          const key = clientKey(client.root, client.serverID)
          log.warn("lsp server died unexpectedly", { serverID: client.serverID, root: client.root })
          LSPBrokenServer.markBroken(s.broken, key)
          const idx = s.clients.indexOf(client)
          if (idx >= 0) s.clients.splice(idx, 1)
          // Best-effort shutdown to release the connection objects. The
          // process is already gone so server stop is a no-op.
          client.shutdown().catch(() => {})
        }
        Bus.publishDetached(Event.Updated, {})
      }, HEALTH_CHECK_INTERVAL_MS)
      s.healthCheck.unref?.()

      return s
    },
    async (state) => {
      if (state.healthCheck) clearInterval(state.healthCheck)
      // Per-client catch so one client's shutdown failure (process
      // already exited, broken pipe, RPC timeout) doesn't skip the
      // others and leak their child processes. The MCP shutdown
      // path at mcp/index.ts:251 already does this for exactly the
      // same reason.
      await Promise.all(
        state.clients.map((client) =>
          client.shutdown().catch((err) => {
            log.error("failed to shutdown LSP client", { serverID: client.serverID, err })
          }),
        ),
      )
    },
  )

  export async function init() {
    return state()
  }

  export const Status = z
    .object({
      id: z.string(),
      name: z.string(),
      root: z.string(),
      status: z.union([z.literal("connected"), z.literal("error")]),
    })
    .meta({
      ref: "LSPStatus",
    })
  export type Status = z.infer<typeof Status>

  export async function status() {
    return state().then((x) => {
      const result: Status[] = []
      for (const client of x.clients) {
        // Guard the server lookup. A client can linger briefly after
        // its server was removed from the servers map (config reload,
        // server disabled), and the previous `x.servers[client.serverID].id`
        // would crash the whole status endpoint with a TypeError.
        const server = x.servers[client.serverID]
        if (!server) continue
        result.push({
          id: client.serverID,
          name: server.id,
          root: path.relative(Instance.directory, client.root),
          status: "connected",
        })
      }
      return result
    })
  }

  type State = Awaited<ReturnType<typeof state>>

  async function resolveRoot(s: State, server: LSPServer.Info, file: string) {
    const key = `${server.id}:${file}`
    if (s.rootCache.has(key)) {
      const cached = s.rootCache.get(key)
      return cached === null ? undefined : cached
    }
    const root = await server.root(file)
    s.rootCache.set(key, root ?? null)
    if (s.rootCache.size > MAX_ROOT_CACHE_ENTRIES) {
      const oldest = s.rootCache.keys().next().value
      if (oldest) s.rootCache.delete(oldest)
    }
    return root
  }

  async function scheduleClient(
    s: State,
    server: LSPServer.Info,
    root: string,
    key: string,
  ): Promise<LSPClient.Info | undefined> {
    let handle: LSPServer.Handle | undefined
    const spawnStarted = performance.now()
    try {
      handle = await server.spawn(root)
      LSPPerf.finishPhase("client.spawn", spawnStarted, Boolean(handle))
      if (!handle) {
        LSPBrokenServer.markBroken(s.broken, key)
        return undefined
      }
    } catch (err) {
      LSPPerf.finishPhase("client.spawn", spawnStarted, false)
      LSPBrokenServer.markBroken(s.broken, key)
      log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
      return undefined
    }

    log.info("spawned lsp server", { serverID: server.id })

    let client: LSPClient.Info | undefined
    const initializeStarted = performance.now()
    try {
      client = await LSPClient.create({
        serverID: server.id,
        server: handle,
        root,
        semantic: server.semantic,
        priority: server.priority,
        capabilityHints: server.capabilityHints,
        onClose: () => {
          log.warn("lsp connection closed unexpectedly", { serverID: server.id, root })
          LSPBrokenServer.markBroken(s.broken, key)
          const idx = s.clients.findIndex((item) => item.root === root && item.serverID === server.id)
          if (idx >= 0) s.clients.splice(idx, 1)
          void stopLSPProcess(handle.process).catch(() => {})
          Bus.publishDetached(Event.Updated, {})
        },
      })
      LSPPerf.finishPhase("client.initialize", initializeStarted, true)
    } catch (err) {
      LSPPerf.finishPhase("client.initialize", initializeStarted, false)
      LSPBrokenServer.markBroken(s.broken, key)
      await stopLSPProcess(handle.process)
      log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
      return undefined
    }

    if (!client) {
      return undefined
    }

    const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
    if (existing) {
      await stopLSPProcess(handle.process)
      return existing
    }

    if (client.closed || !client.ping()) {
      log.warn("lsp client died during spawn, skipping active registration", { serverID: server.id, root })
      LSPBrokenServer.markBroken(s.broken, key)
      await stopLSPProcess(handle.process)
      return undefined
    }

    s.clients.push(client)
    return client
  }

  type PendingClientSpawn = {
    task: Promise<LSPClient.Info | undefined>
    fresh: boolean
  }

  function queueClientForRoot(
    s: State,
    server: LSPServer.Info,
    root: string,
    result: LSPClient.Info[],
    pending: PendingClientSpawn[],
  ): boolean {
    const key = clientKey(root, server.id)
    if (LSPBrokenServer.isBroken(s.broken, key)) return false

    const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
    if (match) {
      result.push(match)
      return false
    }

    const inflight = s.spawning.get(key)
    if (inflight) {
      // Reuse the in-flight promise from a concurrent caller. Don't mark
      // it `fresh` — the originating call will emit the Updated event.
      pending.push({ task: inflight, fresh: false })
      return false
    }

    const task = scheduleClient(s, server, root, key)
    s.spawning.set(key, task)
    task
      .finally(() => {
        if (s.spawning.get(key) === task) {
          s.spawning.delete(key)
        }
      })
      .catch(() => undefined)
    pending.push({ task, fresh: true })
    return true
  }

  async function collectPendingClients(pending: PendingClientSpawn[], result: LSPClient.Info[]): Promise<void> {
    if (pending.length === 0) return

    const resolved = await Promise.all(pending.map((p) => p.task.catch(() => undefined)))
    for (let i = 0; i < resolved.length; i++) {
      const client = resolved[i]
      if (!client) continue
      result.push(client)
      if (pending[i].fresh) Bus.publishDetached(Event.Updated, {})
    }
  }

  async function getClientsDetailed(file: string, opts: ClientOptions = {}): Promise<ClientSelection> {
    const s = await state()
    const extension = path.parse(file).ext || file
    const request = resolveClientRequest(opts)
    const result: LSPClient.Info[] = []
    let freshSpawnCount = 0

    // Pass 1: classify each server-for-this-file and collect pending promises.
    // Servers that already have a client land in `result` directly. Servers
    // currently being spawned reuse the inflight promise. New spawns go into
    // `pending` and are awaited in parallel in pass 2.
    const pending: PendingClientSpawn[] = []

    for (const server of Object.values(s.servers)) {
      if (!serverMatchesClientRequest(server, request)) continue
      if (!serverSupportsFileExtension(server, extension)) continue

      const root = await resolveRoot(s, server, file)
      if (!root) continue

      if (queueClientForRoot(s, server, root, result, pending)) freshSpawnCount++
    }

    // Pass 2: await all pending spawns in parallel. For a file that matches
    // N servers this turns init time from O(sum init) into O(max init).
    await collectPendingClients(pending, result)

    return {
      clients: filterClientsForSelection(result, opts),
      freshSpawnCount,
    }
  }

  async function getClients(file: string, opts: ClientOptions = {}) {
    return (await getClientsDetailed(file, opts)).clients
  }

  const semanticRuntime = { timeoutMs: RPC_TIMEOUT_MS, selectClients: getClientsDetailed }

  async function getWorkspaceClientsDetailed(opts: ClientOptions = {}): Promise<ClientSelection> {
    const s = await state()
    const request = resolveClientRequest(opts)
    const result: LSPClient.Info[] = []
    const pending: PendingClientSpawn[] = []
    const probeByServer = new Map<string, string>()
    let freshSpawnCount = 0
    const eligibleServers = Object.values(s.servers).filter((server) => serverMatchesClientRequest(server, request))

    // Cold workspace symbol should not spawn every configured server.
    // Scan the workspace once and only prime servers for languages that
    // actually exist in the current project.
    for await (const rel of Ripgrep.files({ cwd: Instance.directory })) {
      const probe = path.join(Instance.directory, rel)
      const extension = path.parse(probe).ext || probe
      for (const server of eligibleServers) {
        if (probeByServer.has(server.id)) continue
        if (!serverSupportsFileExtension(server, extension)) continue
        probeByServer.set(server.id, probe)
      }
      if (probeByServer.size === eligibleServers.length) break
    }

    for (const server of eligibleServers) {
      const probe = probeByServer.get(server.id)
      if (!probe) continue
      const root = await server.root(probe)
      if (!root) continue

      if (queueClientForRoot(s, server, root, result, pending)) freshSpawnCount++
    }

    await collectPendingClients(pending, result)

    return {
      clients: filterClientsForSelection(result, opts),
      freshSpawnCount,
    }
  }

  async function hasMatchingClients(
    file: string,
    opts: ClientOptions = {},
    matchesServer?: (server: LSPServer.Info) => boolean,
  ) {
    const s = await state()
    const extension = path.parse(file).ext || file
    const request = resolveClientRequest(opts)
    for (const server of Object.values(s.servers)) {
      if (!serverMatchesClientRequest(server, request)) continue
      if (matchesServer && !matchesServer(server)) continue
      if (!serverSupportsFileExtension(server, extension)) continue
      const root = await resolveRoot(s, server, file)
      if (!root) continue
      if (LSPBrokenServer.isBroken(s.broken, clientKey(root, server.id))) continue
      return true
    }
    return false
  }

  export async function hasClients(file: string, opts: ClientOptions = {}) {
    return hasMatchingClients(file, opts)
  }

  function hasPrewarmClients(file: string, opts: ClientOptions = {}) {
    return hasMatchingClients(file, opts, clientPrewarmMatchesServer)
  }

  export type PrewarmResult = {
    readyCount: number
    freshSpawnCount: number
  }

  export type PrewarmWorkspaceResult = PrewarmResult & {
    files: string[]
  }

  export const selectPrewarmFiles = LSPPrewarm.selectFiles

  export async function prewarmFiles(files: string[], opts: ClientOptions = {}): Promise<PrewarmResult> {
    const request = resolveClientRequest(opts)
    const uniqueFiles = [...new Set(files)]

    return LSPPerf.metered(
      "prewarm",
      {
        files: uniqueFiles.length,
        mode: request.mode,
        methods: request.methods.join(","),
      },
      async () => {
        if (uniqueFiles.length === 0) {
          return { readyCount: 0, freshSpawnCount: 0 }
        }

        const s = await state()
        const planned = new Map<
          string,
          {
            server: LSPServer.Info
            root: string
          }
        >()
        let readyCount = 0
        let freshSpawnCount = 0

        for (const file of uniqueFiles) {
          const extension = path.parse(file).ext || file
          for (const server of Object.values(s.servers)) {
            if (!serverMatchesClientRequest(server, request)) continue
            if (!clientPrewarmMatchesServer(server)) continue
            if (!serverSupportsFileExtension(server, extension)) continue

            const root = await resolveRoot(s, server, file)
            if (!root) continue

            const key = clientKey(root, server.id)
            if (LSPBrokenServer.isBroken(s.broken, key)) continue
            if (planned.has(key)) continue

            const connected = s.clients.find((client) => client.root === root && client.serverID === server.id)
            if (connected) {
              planned.set(key, { server, root })
              readyCount++
              continue
            }

            planned.set(key, { server, root })
          }
        }

        const targets = [...planned.entries()]
          .filter(
            ([, target]) =>
              !s.clients.find((client) => client.root === target.root && client.serverID === target.server.id),
          )
          .sort(([, a], [, b]) => {
            if ((a.server.priority ?? 0) !== (b.server.priority ?? 0)) {
              return (b.server.priority ?? 0) - (a.server.priority ?? 0)
            }
            return a.server.id.localeCompare(b.server.id)
          })

        const pending: PendingClientSpawn[] = []
        const warmed: LSPClient.Info[] = []
        for (const [, target] of targets) {
          if (queueClientForRoot(s, target.server, target.root, warmed, pending)) freshSpawnCount++
        }

        // Independent server roots should warm in parallel. Serializing this
        // loop turns prewarm into O(sum initialize) even though the control
        // plane already parallelizes ordinary getClients() cold starts.
        await collectPendingClients(pending, warmed)
        readyCount += warmed.length

        return {
          readyCount,
          freshSpawnCount,
        }
      },
    )
  }

  export async function prewarmWorkspace(
    opts: ClientOptions & PrewarmSelectionOptions = {},
  ): Promise<PrewarmWorkspaceResult> {
    const maxFiles = Math.max(0, opts.maxFiles ?? 0)
    const maxLanguages = Math.max(0, opts.maxLanguages ?? maxFiles)
    if (maxFiles === 0 || maxLanguages === 0) {
      return { files: [], readyCount: 0, freshSpawnCount: 0 }
    }

    const selected: string[] = []
    const seenLanguages = new Set<string>()

    for await (const rel of Ripgrep.files({ cwd: Instance.directory })) {
      if (selected.length >= maxFiles || seenLanguages.size >= maxLanguages) break

      const probe = path.join(Instance.directory, rel)
      const language = LSPPrewarm.detectLanguage(probe)
      if (language === "unknown" || language === "plaintext") continue
      if (seenLanguages.has(language)) continue
      if (!(await hasPrewarmClients(probe, opts))) continue

      selected.push(probe)
      seenLanguages.add(language)
    }

    const warmed = await prewarmFiles(selected, opts)
    log.info("workspace semantic prewarm completed", {
      files: selected.length,
      readyCount: warmed.readyCount,
      freshSpawnCount: warmed.freshSpawnCount,
      mode: opts.mode ?? "all",
      methods: requestedMethods(opts).join(","),
    })
    return {
      files: selected,
      ...warmed,
    }
  }

  export async function touchFile(input: string, waitForDiagnostics?: boolean, opts: ClientOptions = {}) {
    const mode = opts.mode ?? "all"
    log.info("touching file", { file: input, mode })
    return LSPPerf.metered("touch", { file: input, mode }, async () => {
      let selection: ClientSelection = { clients: [], freshSpawnCount: 0 }
      const selectStarted = performance.now()
      try {
        selection = await getClientsDetailed(input, opts)
        const durationMs = LSPPerf.finishPhase("touch.select", selectStarted, true)
        if (selection.freshSpawnCount > 0) {
          LSPPerf.recordSample("touch.select.spawned", durationMs, true)
        }
      } catch (err) {
        LSPPerf.finishPhase("touch.select", selectStarted, false)
        log.error("failed to get clients for touch", { err, file: input })
      }
      const clients = selection.clients
      const notifyStarted = performance.now()
      const { count: opened, ok: notifyOk } = await LSPClientNotify.openAll(clients, {
        path: input,
        waitForDiagnostics,
      })
      LSPPerf.finishPhase("touch.notify", notifyStarted, notifyOk)
      return opened
    })
  }

  // Close a file on every client that has it open. Sends textDocument/didClose
  // and removes per-file state (version, content fingerprint, cached
  // diagnostics). Used when a file is deleted, renamed, or no longer relevant
  // to the current task. Safe to call on files that were never opened — each
  // client short-circuits non-matching paths.
  export async function closeFile(input: string, deleted = false) {
    log.info("closing file", { file: input })
    const s = await state()
    await LSPClientNotify.closeAll(s.clients, { path: input, deleted })
  }

  // Manually clear the broken-server cooldown map. The next getClients() call
  // for a previously-broken (root, server) pair will attempt a fresh spawn.
  // Use this after fixing a server binary, editing LSP config, or any other
  // manual intervention that would make retry pointful. Returns the number
  // of entries that were cleared.
  export async function resetBroken() {
    const s = await state()
    const count = s.broken.size
    s.broken.clear()
    log.info("reset broken lsp servers", { count })
    return count
  }

  export async function diagnostics() {
    const s = await state()
    return LSPDiagnostics.collect(s.clients)
  }

  // Aggregate diagnostics across all connected clients. Pass `file`
  // to limit to a single file; omit to get everything.
  export async function diagnosticsAggregated(file?: string): Promise<SemanticEnvelope<NormalizedDiagnostic[]>> {
    const s = await state()
    return LSPDiagnostics.aggregateEnvelope(s.clients, file)
  }

  export async function hoverEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return LSPPoint.hoverEnvelope(input, semanticRuntime)
  }

  export async function hover(input: { file: string; line: number; character: number }) {
    return LSPPoint.hover(input, semanticRuntime)
  }

  // Back-compat alias for the original workspaceSymbol-specific shape.
  // Existing tests and tool code read `envelope.symbols` via this alias;
  // the generic envelope shape is preferred for new surfaces. `degraded`
  // is optional to preserve back-compat for consumers reading the
  // original v1 shape.
  export type SymbolEnvelope = LSPWorkspaceSymbol.SymbolEnvelope

  export async function workspaceSymbolEnvelope(query: string): Promise<SymbolEnvelope> {
    return LSPWorkspaceSymbol.envelope({
      query,
      timeoutMs: RPC_TIMEOUT_LONG_MS,
      limit: 10,
      selectClients: getWorkspaceClientsDetailed,
    })
  }

  // Back-compat wrapper: returns just the symbol array. Existing callers
  // (CLI debug path, older tests) keep working; new AI-facing surfaces should
  // read the envelope directly via workspaceSymbolEnvelope.
  export async function workspaceSymbol(query: string) {
    const envelope = await workspaceSymbolEnvelope(query)
    return envelope.symbols
  }

  // Envelope-returning variants for references/documentSymbol/hover/
  // definition. Each wraps the same underlying LSP call but tracks per-
  // client failure so AI consumers can tell "no server available" from
  // "some server crashed, here is the partial result" from "all clear".
  // The bare functions below become back-compat wrappers that discard the
  // envelope; new AI-facing consumers should read the envelope variant.

  export async function documentSymbolCachedEnvelope(
    uri: string,
  ): Promise<SemanticEnvelope<(LSP.DocumentSymbol | LSP.Symbol)[]> | undefined> {
    return LSPDocumentSymbol.cachedEnvelope(uri)
  }

  export async function documentSymbolEnvelope(
    uri: string,
    opts?: {
      cache?: boolean
    },
  ): Promise<SemanticEnvelope<(LSP.DocumentSymbol | LSP.Symbol)[]>> {
    return LSPDocumentSymbol.envelope(uri, {
      cache: opts?.cache,
      ...semanticRuntime,
    })
  }

  export async function documentSymbol(uri: string) {
    return LSPDocumentSymbol.documentSymbols(uri, semanticRuntime)
  }

  export async function definitionEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return LSPPoint.definitionEnvelope(input, semanticRuntime)
  }

  export async function definition(input: { file: string; line: number; character: number }) {
    return LSPPoint.definition(input, semanticRuntime)
  }

  export async function referencesCachedEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]> | undefined> {
    return LSPReferences.cachedEnvelope(input)
  }

  export async function referencesEnvelope(input: {
    file: string
    line: number
    character: number
    cache?: boolean
  }): Promise<SemanticEnvelope<unknown[]>> {
    return LSPReferences.envelope(input, semanticRuntime)
  }

  export async function references(input: { file: string; line: number; character: number }) {
    return LSPReferences.references(input, semanticRuntime)
  }

  export async function implementation(input: { file: string; line: number; character: number }) {
    return LSPPoint.implementation(input, semanticRuntime)
  }

  export async function implementationEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return LSPPoint.implementationEnvelope(input, semanticRuntime)
  }

  export async function prepareCallHierarchy(input: { file: string; line: number; character: number }) {
    return LSPPoint.prepareCallHierarchy(input, semanticRuntime)
  }

  export async function prepareCallHierarchyEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return LSPPoint.prepareCallHierarchyEnvelope(input, semanticRuntime)
  }

  export async function incomingCalls(input: { file: string; line: number; character: number }) {
    return LSPPoint.incomingCalls(input, semanticRuntime)
  }

  export async function incomingCallsEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return LSPPoint.incomingCallsEnvelope(input, semanticRuntime)
  }

  export async function outgoingCalls(input: { file: string; line: number; character: number }) {
    return LSPPoint.outgoingCalls(input, semanticRuntime)
  }

  export async function outgoingCallsEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return LSPPoint.outgoingCallsEnvelope(input, semanticRuntime)
  }

  export const Diagnostic = LSPDiagnostics.Diagnostic
}
