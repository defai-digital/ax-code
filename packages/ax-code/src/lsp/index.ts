import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { Env } from "../util/env"
import { LSPClient } from "./client"
import path from "path"
import { pathToFileURL, fileURLToPath } from "url"
import { LSPServer } from "./server"
import z from "zod"
import { Config } from "../config/config"
import { Instance } from "../project/instance"
import { Flag } from "@/flag/flag"
import { Process } from "../util/process"
import { spawn as lspspawn } from "./launch"
import { withTimeout } from "../util/timeout"
import { Ripgrep } from "../file/ripgrep"
import { CodeGraphQuery } from "../code-intelligence/query"
import type { LspCacheOperation } from "../code-intelligence/schema.sql"
import { LspScheduler } from "./scheduler"
import { BuiltinServerProfiles } from "./server-profile"
import { LANGUAGE_EXTENSIONS } from "./language"

export namespace LSP {
  const log = Log.create({ service: "lsp" })

  // Bounded ring of recent durations per LSP operation. `perf:index` snapshots
  // this to attribute orchestration/RPC cost at the operation level (touch,
  // documentSymbol, references, workspaceSymbol) — the baseline metric the
  // PRD requires before any native-extraction decision gate is evaluated.
  //
  // A ring (not an unbounded array) keeps long sessions bounded. We keep
  // enough samples for stable p50/p95 without retaining session-long history.
  const PERF_SAMPLE_CAP = 1024

  type PerfEntry = {
    durations: number[] // ring buffer of recent sample durations
    cursor: number // next write slot; wraps at PERF_SAMPLE_CAP
    okCount: number // monotonic since last reset
    errorCount: number
  }

  const perfSamples = new Map<string, PerfEntry>()

  // Exported for unit tests. Drives the sampler directly so ring-wrap,
  // all-error, and mixed-status cases can be exercised without spinning up
  // an actual LSP client. Production code should only reach this via the
  // `metered()` wrapper.
  export function recordPerfSampleForTest(operation: string, durationMs: number, ok: boolean) {
    recordPerf(operation, durationMs, ok)
  }

  function recordPerf(operation: string, durationMs: number, ok: boolean) {
    let entry = perfSamples.get(operation)
    if (!entry) {
      entry = { durations: [], cursor: 0, okCount: 0, errorCount: 0 }
      perfSamples.set(operation, entry)
    }
    if (entry.durations.length < PERF_SAMPLE_CAP) {
      entry.durations.push(durationMs)
    } else {
      entry.durations[entry.cursor] = durationMs
      entry.cursor = (entry.cursor + 1) % PERF_SAMPLE_CAP
    }
    if (ok) entry.okCount++
    else entry.errorCount++
  }

  function finishPerfPhase(operation: string, started: number, ok: boolean) {
    const durationMs = Math.round(performance.now() - started)
    recordPerf(operation, durationMs, ok)
    return durationMs
  }

  // Exported for unit tests. The cap is load-bearing for p95 stability and
  // memory bounds; tests assert ring-wrap behavior against this value.
  export const PERF_SAMPLE_CAP_FOR_TEST = PERF_SAMPLE_CAP

  function percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
    return sorted[idx]!
  }

  export type PerfRow = {
    count: number
    okCount: number
    errorCount: number
    p50: number
    p95: number
    maxMs: number
    totalMs: number
  }

  export function perfSnapshot(): Record<string, PerfRow> {
    const out: Record<string, PerfRow> = {}
    for (const [op, entry] of perfSamples) {
      const sorted = [...entry.durations].sort((a, b) => a - b)
      const totalMs = sorted.reduce((s, v) => s + v, 0)
      out[op] = {
        count: entry.okCount + entry.errorCount,
        okCount: entry.okCount,
        errorCount: entry.errorCount,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        maxMs: sorted.at(-1) ?? 0,
        totalMs,
      }
    }
    return out
  }

  export function perfReset() {
    perfSamples.clear()
  }

  // Emit a structured perf line for an LSP hotspot and record it in the
  // in-memory sampler. The operation name is the public API surface
  // (`touch`, `documentSymbol`, `references`, `workspaceSymbol`), not the
  // underlying RPC method — callers aggregate on the surface name.
  async function metered<T>(
    operation: string,
    extra: Record<string, unknown>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const started = performance.now()
    try {
      const result = await fn()
      const durationMs = Math.round(performance.now() - started)
      recordPerf(operation, durationMs, true)
      log.info("lsp.perf", {
        operation,
        durationMs,
        status: "ok",
        ...extra,
      })
      return result
    } catch (err) {
      const durationMs = Math.round(performance.now() - started)
      recordPerf(operation, durationMs, false)
      log.warn("lsp.perf", {
        operation,
        durationMs,
        status: "error",
        errorCode: err instanceof Error ? err.name : "unknown",
        ...extra,
      })
      throw err
    }
  }

  // Bound LSP RPC calls so a hung language server cannot block tool execution.
  // Pointwise queries get a short budget; workspace-wide queries get a longer
  // one because they may scan the entire project on first call.
  const RPC_TIMEOUT_MS = 5_000
  const RPC_TIMEOUT_LONG_MS = 15_000

  // Exponential backoff for broken servers. A server that fails to spawn or
  // initialize is marked broken and skipped until nextAttempt. After the
  // cooldown expires the entry is dropped and the next getClients() call will
  // retry the spawn. Failures compound the backoff to avoid hammering a
  // server that is genuinely unrecoverable (missing binary, bad config).
  //   attempt 1 failure →  30s
  //   attempt 2 failure →   2m
  //   attempt 3 failure →   8m
  //   attempt 4 failure →  32m
  //   attempt 5+ failure →  60m (capped)
  const BROKEN_BACKOFF_BASE_MS = 30_000
  const BROKEN_BACKOFF_MAX_MS = 60 * 60 * 1000

  // Exported for unit tests. Deterministic pure function — no side effects.
  export function computeBackoff(failures: number): number {
    const raw = BROKEN_BACKOFF_BASE_MS * Math.pow(4, failures - 1)
    return Math.min(raw, BROKEN_BACKOFF_MAX_MS)
  }

  export type BrokenEntry = {
    failures: number
    nextAttempt: number
  }

  // How often the health-check loop runs. A dead-process probe is cheap
  // (kill -0 syscall), so we can run it frequently without concern. 60s is
  // responsive enough for interactive use without generating log noise.
  const HEALTH_CHECK_INTERVAL_MS = 60_000
  const MAX_ROOT_CACHE_ENTRIES = 2_000

  // Check whether a (root, server) key is currently in cooldown. If the
  // cooldown has expired we eagerly drop the entry so the next caller can
  // retry a fresh spawn. The caller tracks failure count across retries so
  // backoff compounds on repeat failures.
  // Exported for unit tests.
  export function isBroken(broken: Map<string, BrokenEntry>, key: string): boolean {
    const entry = broken.get(key)
    if (!entry) return false
    if (Date.now() >= entry.nextAttempt) {
      broken.delete(key)
      return false
    }
    return true
  }

  // Exported for unit tests.
  export function markBroken(broken: Map<string, BrokenEntry>, key: string) {
    const existing = broken.get(key)
    const failures = (existing?.failures ?? 0) + 1
    const backoffMs = computeBackoff(failures)
    broken.set(key, {
      failures,
      nextAttempt: Date.now() + backoffMs,
    })
    log.info("lsp server marked broken", { key, failures, backoffMs })
  }

  export const Event = {
    Updated: BusEvent.define("lsp.updated", z.object({})),
  }

  export const Range = z
    .object({
      start: z.object({
        line: z.number(),
        character: z.number(),
      }),
      end: z.object({
        line: z.number(),
        character: z.number(),
      }),
    })
    .meta({
      ref: "Range",
    })
  export type Range = z.infer<typeof Range>

  export const Symbol = z
    .object({
      name: z.string(),
      kind: z.number(),
      location: z.object({
        uri: z.string(),
        range: Range,
      }),
    })
    .meta({
      ref: "Symbol",
    })
  export type Symbol = z.infer<typeof Symbol>

  export const DocumentSymbol = z
    .object({
      name: z.string(),
      detail: z.string().optional(),
      kind: z.number(),
      range: Range,
      selectionRange: Range,
    })
    .meta({
      ref: "DocumentSymbol",
    })
  export type DocumentSymbol = z.infer<typeof DocumentSymbol>

  export type ClientMode = "all" | "semantic"

  type ClientOptions = {
    mode?: ClientMode
    method?: LSPServer.Method
    methods?: LSPServer.Method[]
  }

  type PrewarmSelectionOptions = {
    maxFiles?: number
    maxLanguages?: number
  }

  type ClientSelection = {
    clients: LSPClient.Info[]
    freshSpawnCount: number
  }

  export function clientModeMatchesServer(mode: ClientMode, semantic?: boolean) {
    return mode === "all" || semantic !== false
  }

  function requestedMethods(opts: ClientOptions): LSPServer.Method[] {
    const seen = new Set<LSPServer.Method>()
    const methods: LSPServer.Method[] = []
    if (opts.method && !seen.has(opts.method)) {
      seen.add(opts.method)
      methods.push(opts.method)
    }
    for (const method of opts.methods ?? []) {
      if (seen.has(method)) continue
      seen.add(method)
      methods.push(method)
    }
    return methods
  }

  export function clientMethodMatchesServer(
    method: LSPServer.Method | LSPServer.Method[] | undefined,
    capabilityHints?: LSPServer.CapabilityHints,
  ) {
    const methods = Array.isArray(method) ? method : method ? [method] : []
    if (methods.length === 0) return true
    return methods.some((candidate) => capabilityHints?.[candidate] !== false)
  }

  function mergeCapabilityHints(
    ...hints: Array<LSPServer.CapabilityHints | undefined>
  ): LSPServer.CapabilityHints | undefined {
    const merged: LSPServer.CapabilityHints = {}
    for (const hint of hints) {
      if (!hint) continue
      Object.assign(merged, hint)
    }
    return Object.keys(merged).length > 0 ? merged : undefined
  }

  function sortClients(clients: LSPClient.Info[]): LSPClient.Info[] {
    return [...clients].sort((a, b) => {
      if (a.priority !== b.priority) return b.priority - a.priority
      return a.serverID.localeCompare(b.serverID)
    })
  }

  function filterClientsForMethod(clients: LSPClient.Info[], method: LSPServer.Method | undefined): LSPClient.Info[] {
    if (!method) return sortClients(clients)

    const supported = clients.filter((client) => client.methodSupport(method) === "supported")
    if (supported.length > 0) return sortClients(supported)

    const maybeSupported = clients.filter((client) => client.methodSupport(method) !== "unsupported")
    if (maybeSupported.length > 0) return sortClients(maybeSupported)

    return sortClients(clients)
  }

  function filterClientsForMethods(clients: LSPClient.Info[], methods: LSPServer.Method[]): LSPClient.Info[] {
    if (methods.length === 0) return sortClients(clients)

    return [...clients].sort((a, b) => {
      const aSupported = methods.filter((method) => a.methodSupport(method) === "supported").length
      const bSupported = methods.filter((method) => b.methodSupport(method) === "supported").length
      if (aSupported !== bSupported) return bSupported - aSupported

      const aMaybe = methods.filter((method) => a.methodSupport(method) !== "unsupported").length
      const bMaybe = methods.filter((method) => b.methodSupport(method) !== "unsupported").length
      if (aMaybe !== bMaybe) return bMaybe - aMaybe

      if (a.priority !== b.priority) return b.priority - a.priority
      return a.serverID.localeCompare(b.serverID)
    })
  }

  function filterClientsForSelection(clients: LSPClient.Info[], opts: ClientOptions): LSPClient.Info[] {
    if (opts.method) return filterClientsForMethod(clients, opts.method)

    const methods = requestedMethods(opts)
    if (methods.length > 0) return filterClientsForMethods(clients, methods)

    return sortClients(clients)
  }

  const filterExperimentalServers = (servers: Record<string, LSPServer.Info>) => {
    if (Flag.AX_CODE_EXPERIMENTAL_LSP_TY) {
      // If experimental flag is enabled, disable pyright
      if (servers["pyright"]) {
        log.info("LSP server pyright is disabled because AX_CODE_EXPERIMENTAL_LSP_TY is enabled")
        delete servers["pyright"]
      }
    } else {
      // If experimental flag is disabled, disable ty
      if (servers["ty"]) {
        delete servers["ty"]
      }
    }
  }

  const state = Instance.state(
    async () => {
      const clients: LSPClient.Info[] = []
      const servers: Record<string, LSPServer.Info> = {}
      const cfg = await Config.get()

      if (cfg.lsp === false) {
        log.info("all LSPs are disabled")
        return {
          broken: new Map<string, BrokenEntry>(),
          servers,
          clients,
          rootCache: new Map<string, string | null>(),
          spawning: new Map<string, Promise<LSPClient.Info | undefined>>(),
          healthCheck: undefined,
        }
      }

      for (const server of Object.values(LSPServer)) {
        const profile = BuiltinServerProfiles[server.id]
        servers[server.id] = {
          ...server,
          semantic: server.semantic ?? profile?.semantic ?? true,
          priority: server.priority ?? profile?.priority ?? 0,
          concurrency: server.concurrency ?? profile?.concurrency,
          capabilityHints: mergeCapabilityHints(profile?.capabilityHints, server.capabilityHints),
        }
      }

      filterExperimentalServers(servers)

      for (const [name, item] of Object.entries(cfg.lsp ?? {})) {
        const existing = servers[name]
        if (item.disabled) {
          log.info(`LSP server ${name} is disabled`)
          delete servers[name]
          continue
        }
        servers[name] = {
          ...existing,
          id: name,
          semantic: item.semantic ?? existing?.semantic ?? true,
          priority: item.priority ?? existing?.priority ?? 0,
          concurrency: item.concurrency ?? existing?.concurrency,
          capabilityHints: mergeCapabilityHints(existing?.capabilityHints, item.capabilities),
          root: existing?.root ?? (async () => Instance.directory),
          extensions: item.extensions ?? existing?.extensions ?? [],
          spawn: async (root) => {
            if (item.command) {
              return {
                process: lspspawn(item.command[0], item.command.slice(1), {
                  cwd: root,
                  env: {
                    ...Env.sanitize(),
                    ...item.env,
                  },
                }),
                initialization: item.initialization,
              }
            }

            if (!existing?.spawn) return undefined
            const handle = await existing.spawn(root)
            if (!handle) return handle
            if (!item.initialization) return handle
            return {
              ...handle,
              initialization: {
                ...(handle.initialization ?? {}),
                ...item.initialization,
              },
            }
          },
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
        broken: new Map<string, BrokenEntry>(),
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
          const key = client.root + client.serverID
          log.warn("lsp server died unexpectedly", { serverID: client.serverID, root: client.root })
          markBroken(s.broken, key)
          const idx = s.clients.indexOf(client)
          if (idx >= 0) s.clients.splice(idx, 1)
          // Best-effort shutdown to release the connection objects. The
          // process is already gone so Process.stop is a no-op.
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
      finishPerfPhase("client.spawn", spawnStarted, Boolean(handle))
      if (!handle) {
        markBroken(s.broken, key)
        return undefined
      }
    } catch (err) {
      finishPerfPhase("client.spawn", spawnStarted, false)
      markBroken(s.broken, key)
      log.error(`Failed to spawn LSP server ${server.id}`, { error: err })
      return undefined
    }

    if (!handle) return undefined
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
      })
      finishPerfPhase("client.initialize", initializeStarted, true)
    } catch (err) {
      finishPerfPhase("client.initialize", initializeStarted, false)
      markBroken(s.broken, key)
      await Process.stop(handle.process)
      log.error(`Failed to initialize LSP client ${server.id}`, { error: err })
      return undefined
    }

    if (!client) {
      return undefined
    }

    const existing = s.clients.find((x) => x.root === root && x.serverID === server.id)
    if (existing) {
      await Process.stop(handle.process)
      return existing
    }

    s.clients.push(client)
    return client
  }

  async function getClientsDetailed(file: string, opts: ClientOptions = {}): Promise<ClientSelection> {
    const s = await state()
    const extension = path.parse(file).ext || file
    const mode = opts.mode ?? "all"
    const methods = requestedMethods(opts)
    const result: LSPClient.Info[] = []
    let freshSpawnCount = 0

    // Pass 1: classify each server-for-this-file and collect pending promises.
    // Servers that already have a client land in `result` directly. Servers
    // currently being spawned reuse the inflight promise. New spawns go into
    // `pending` and are awaited in parallel in pass 2.
    const pending: { key: string; task: Promise<LSPClient.Info | undefined>; fresh: boolean }[] = []

    for (const server of Object.values(s.servers)) {
      if (!clientModeMatchesServer(mode, server.semantic)) continue
      if (!clientMethodMatchesServer(methods, server.capabilityHints)) continue
      if (server.extensions.length && !server.extensions.includes(extension)) continue

      const root = await resolveRoot(s, server, file)
      if (!root) continue
      const key = root + server.id
      if (isBroken(s.broken, key)) continue

      const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (match) {
        result.push(match)
        continue
      }

      const inflight = s.spawning.get(key)
      if (inflight) {
        // Reuse the in-flight promise from a concurrent caller. Don't mark
        // it `fresh` — the originating call will emit the Updated event.
        pending.push({ key, task: inflight, fresh: false })
        continue
      }

      const task = scheduleClient(s, server, root, key)
      s.spawning.set(key, task)
      task.finally(() => {
        if (s.spawning.get(key) === task) {
          s.spawning.delete(key)
        }
      })
      freshSpawnCount++
      pending.push({ key, task, fresh: true })
    }

    // Pass 2: await all pending spawns in parallel. For a file that matches
    // N servers this turns init time from O(sum init) into O(max init).
    if (pending.length > 0) {
      const resolved = await Promise.all(pending.map((p) => p.task.catch(() => undefined)))
      for (let i = 0; i < resolved.length; i++) {
        const client = resolved[i]
        if (!client) continue
        result.push(client)
        if (pending[i].fresh) Bus.publishDetached(Event.Updated, {})
      }
    }

    return {
      clients: filterClientsForSelection(result, opts),
      freshSpawnCount,
    }
  }

  async function getClients(file: string, opts: ClientOptions = {}) {
    return (await getClientsDetailed(file, opts)).clients
  }

  async function getWorkspaceClientsDetailed(opts: ClientOptions = {}): Promise<ClientSelection> {
    const s = await state()
    const mode = opts.mode ?? "all"
    const methods = requestedMethods(opts)
    const result: LSPClient.Info[] = []
    const pending: { key: string; task: Promise<LSPClient.Info | undefined>; fresh: boolean }[] = []
    const probeByServer = new Map<string, string>()
    let freshSpawnCount = 0
    const eligibleServers = Object.values(s.servers).filter(
      (server) => clientModeMatchesServer(mode, server.semantic) && clientMethodMatchesServer(methods, server.capabilityHints),
    )

    // Cold workspace symbol should not spawn every configured server.
    // Scan the workspace once and only prime servers for languages that
    // actually exist in the current project.
    for await (const rel of Ripgrep.files({ cwd: Instance.directory })) {
      const probe = path.join(Instance.directory, rel)
      const extension = path.parse(probe).ext || probe
      for (const server of eligibleServers) {
        if (probeByServer.has(server.id)) continue
        if (server.extensions.length && !server.extensions.includes(extension)) continue
        probeByServer.set(server.id, probe)
      }
      if (probeByServer.size === eligibleServers.length) break
    }

    for (const server of eligibleServers) {
      const probe = probeByServer.get(server.id)
      if (!probe) continue
      const root = await server.root(probe)
      if (!root) continue
      const key = root + server.id
      if (isBroken(s.broken, key)) continue

      const match = s.clients.find((x) => x.root === root && x.serverID === server.id)
      if (match) {
        result.push(match)
        continue
      }

      const inflight = s.spawning.get(key)
      if (inflight) {
        pending.push({ key, task: inflight, fresh: false })
        continue
      }

      const task = scheduleClient(s, server, root, key)
      s.spawning.set(key, task)
      task.finally(() => {
        if (s.spawning.get(key) === task) {
          s.spawning.delete(key)
        }
      })
      freshSpawnCount++
      pending.push({ key, task, fresh: true })
    }

    if (pending.length > 0) {
      const resolved = await Promise.all(pending.map((p) => p.task.catch(() => undefined)))
      for (let i = 0; i < resolved.length; i++) {
        const client = resolved[i]
        if (!client) continue
        result.push(client)
        if (pending[i].fresh) Bus.publishDetached(Event.Updated, {})
      }
    }

    return {
      clients: filterClientsForSelection(result, opts),
      freshSpawnCount,
    }
  }

  export async function hasClients(file: string, opts: ClientOptions = {}) {
    const s = await state()
    const extension = path.parse(file).ext || file
    const mode = opts.mode ?? "all"
    const methods = requestedMethods(opts)
    for (const server of Object.values(s.servers)) {
      if (!clientModeMatchesServer(mode, server.semantic)) continue
      if (!clientMethodMatchesServer(methods, server.capabilityHints)) continue
      if (server.extensions.length && !server.extensions.includes(extension)) continue
      const root = await resolveRoot(s, server, file)
      if (!root) continue
      if (isBroken(s.broken, root + server.id)) continue
      return true
    }
    return false
  }

  export type PrewarmResult = {
    readyCount: number
    freshSpawnCount: number
  }

  export type PrewarmWorkspaceResult = PrewarmResult & {
    files: string[]
  }

  function detectPrewarmLanguage(file: string): string {
    const extension = path.parse(file).ext || file
    return LANGUAGE_EXTENSIONS[extension] ?? "unknown"
  }

  export function selectPrewarmFiles(files: string[], opts: PrewarmSelectionOptions = {}): string[] {
    const maxFiles = Math.max(0, opts.maxFiles ?? files.length)
    const maxLanguages = Math.max(0, opts.maxLanguages ?? maxFiles)
    if (maxFiles === 0 || maxLanguages === 0) return []

    const selected: string[] = []
    const seenLanguages = new Set<string>()

    for (const file of files) {
      if (selected.length >= maxFiles || seenLanguages.size >= maxLanguages) break

      const language = detectPrewarmLanguage(file)
      if (language === "unknown" || language === "plaintext") continue
      if (seenLanguages.has(language)) continue

      selected.push(file)
      seenLanguages.add(language)
    }

    return selected
  }

  export async function prewarmFiles(files: string[], opts: ClientOptions = {}): Promise<PrewarmResult> {
    const mode = opts.mode ?? "all"
    const methods = requestedMethods(opts)
    const uniqueFiles = [...new Set(files)]

    return metered(
      "prewarm",
      {
        files: uniqueFiles.length,
        mode,
        methods: methods.join(","),
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
            if (!clientModeMatchesServer(mode, server.semantic)) continue
            if (!clientMethodMatchesServer(methods, server.capabilityHints)) continue
            if (server.extensions.length && !server.extensions.includes(extension)) continue

            const root = await resolveRoot(s, server, file)
            if (!root) continue

            const key = root + server.id
            if (isBroken(s.broken, key)) continue
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
          .filter(([, target]) => !s.clients.find((client) => client.root === target.root && client.serverID === target.server.id))
          .sort(([, a], [, b]) => {
            if ((a.server.priority ?? 0) !== (b.server.priority ?? 0)) {
              return (b.server.priority ?? 0) - (a.server.priority ?? 0)
            }
            return a.server.id.localeCompare(b.server.id)
          })

        const pending: { task: Promise<LSPClient.Info | undefined>; fresh: boolean }[] = []
        for (const [key, target] of targets) {
          const inflight = s.spawning.get(key)
          if (inflight) {
            pending.push({ task: inflight, fresh: false })
            continue
          }

          const task = scheduleClient(s, target.server, target.root, key)
          s.spawning.set(key, task)
          task.finally(() => {
            if (s.spawning.get(key) === task) {
              s.spawning.delete(key)
            }
          })

          freshSpawnCount++
          pending.push({ task, fresh: true })
        }

        // Independent server roots should warm in parallel. Serializing this
        // loop turns prewarm into O(sum initialize) even though the control
        // plane already parallelizes ordinary getClients() cold starts.
        if (pending.length > 0) {
          const resolved = await Promise.all(pending.map((entry) => entry.task.catch(() => undefined)))
          for (let i = 0; i < resolved.length; i++) {
            const client = resolved[i]
            if (!client) continue
            readyCount++
            if (pending[i]?.fresh) Bus.publishDetached(Event.Updated, {})
          }
        }

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
      const language = detectPrewarmLanguage(probe)
      if (language === "unknown" || language === "plaintext") continue
      if (seenLanguages.has(language)) continue
      if (!(await hasClients(probe, opts))) continue

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
    return metered("touch", { file: input, mode }, async () => {
      let selection: ClientSelection = { clients: [], freshSpawnCount: 0 }
      const selectStarted = performance.now()
      try {
        selection = await getClientsDetailed(input, opts)
        const durationMs = finishPerfPhase("touch.select", selectStarted, true)
        if (selection.freshSpawnCount > 0) {
          recordPerf("touch.select.spawned", durationMs, true)
        }
      } catch (err) {
        finishPerfPhase("touch.select", selectStarted, false)
        log.error("failed to get clients for touch", { err, file: input })
      }
      const clients = selection.clients
      // allSettled: one flaky client must not block healthy ones. Each client
      // either completes its notify.open or fails individually with a logged
      // error that carries the serverID for debugging.
      const notifyStarted = performance.now()
      const results = await Promise.allSettled(
        clients.map((client) => client.notify.open({ path: input, waitForDiagnostics })),
      )
      let opened = 0
      let notifyOk = true
      for (let i = 0; i < results.length; i++) {
        const r = results[i]
        if (r.status === "rejected") {
          notifyOk = false
          log.error("failed to touch file for client", {
            err: r.reason,
            file: input,
            serverID: clients[i]?.serverID,
          })
          continue
        }
        opened++
      }
      finishPerfPhase("touch.notify", notifyStarted, notifyOk)
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
    // allSettled: see note in touchFile. Per-client failures are logged with
    // the serverID and do not block cleanup on the other clients — local
    // state eviction on the failing client still happens inside notify.close
    // because notify.close only catches connection errors, not state deletes.
    const results = await Promise.allSettled(
      s.clients.map((client) => client.notify.close({ path: input, deleted })),
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === "rejected") {
        log.error("failed to close file for client", {
          err: r.reason,
          file: input,
          serverID: s.clients[i]?.serverID,
        })
      }
    }
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
    const results: Record<string, LSPClient.Diagnostic[]> = {}
    for (const result of await runAll(async (client) => client.diagnostics)) {
      for (const [path, diagnostics] of result.entries()) {
        const arr = results[path] || []
        arr.push(...diagnostics)
        results[path] = arr
      }
    }
    return results
  }

  // ─── Aggregated diagnostics (Semantic Trust v2 §S3) ────────────────
  //
  // AI-facing diagnostics surface. The raw `diagnostics()` above
  // exposes unmerged per-server publishes; a polyglot project with
  // (typescript + eslint) on the same file will return duplicate
  // entries where the servers agree. Consumers then have to normalize
  // severity (a numeric 1..4 in VSCode protocol) and dedup by
  // (range, message) themselves.
  //
  // `diagnosticsAggregated` does both. Per-file iteration uses the
  // per-client diagnostic Map that each LSPClient maintains via its
  // publishDiagnostics notification handler (see client.ts) — no new
  // subscription layer needed, the state is already kept by the
  // client layer.
  //
  // Returns an envelope so AI consumers can see provenance (which
  // servers contributed, timestamp, completeness, degraded) — same
  // contract as every other v1/v2 AI-facing semantic API.

  export type NormalizedSeverity = "error" | "warning" | "info" | "hint"

  export type NormalizedDiagnostic = {
    path: string
    range: { start: { line: number; character: number }; end: { line: number; character: number } }
    severity: NormalizedSeverity
    message: string
    source?: string
    code?: string | number
    // Servers that published this diagnostic. Usually one; >1 when
    // multiple servers report the same (location, message) pair.
    serverIDs: string[]
  }

  function normalizeSeverity(s: number | undefined): NormalizedSeverity {
    // VSCode protocol: 1=error, 2=warning, 3=info, 4=hint. Omitted
    // severity is client-interpretable per spec; we default to `info`
    // on the grounds that an unclassified diagnostic shouldn't be
    // silently upgraded to `error` nor downgraded to `hint`.
    if (s === 1) return "error"
    if (s === 2) return "warning"
    if (s === 3) return "info"
    if (s === 4) return "hint"
    return "info"
  }

  function dedupKeyOf(path: string, d: LSPClient.Diagnostic): string {
    const r = d.range
    return [
      path,
      r.start.line,
      r.start.character,
      r.end.line,
      r.end.character,
      d.message,
    ].join("\u0000")
  }

  // Pure aggregation kernel, exported for unit tests. Real call site
  // is `diagnosticsAggregated` below, which just plumbs live clients
  // and a timestamp into this function. Separating the pure logic
  // from the Instance-bound state lookup makes aggregation semantics
  // testable without standing up real LSP clients.
  export type DiagnosticsAggregateInput = {
    serverID: string
    diagnostics: Map<string, LSPClient.Diagnostic[]>
  }
  export function aggregateDiagnosticsForTest(
    inputs: DiagnosticsAggregateInput[],
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
      const entries = opts.file
        ? map.has(opts.file)
          ? [[opts.file, map.get(opts.file)!] as const]
          : []
        : [...map.entries()]
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
      if (a.range.start.character !== b.range.start.character)
        return a.range.start.character - b.range.start.character
      return a.message < b.message ? -1 : a.message > b.message ? 1 : 0
    })

    return {
      data,
      source: "lsp",
      // Match runWithEnvelopeUncollapsed's convention: "empty" iff no
      // server actually contributed data, "full" otherwise. Previously
      // this branch always returned "full", which was misleading when
      // connected clients had empty diagnostic maps (servers up but
      // none have published anything for the requested file(s)).
      completeness: participatingServerIDs.size === 0 ? "empty" : "full",
      timestamp: opts.now,
      serverIDs: [...participatingServerIDs],
      degraded: false,
    }
  }

  // Aggregate diagnostics across all connected clients. Pass `file`
  // to limit to a single file; omit to get everything.
  export async function diagnosticsAggregated(file?: string): Promise<SemanticEnvelope<NormalizedDiagnostic[]>> {
    return metered("diagnosticsAggregated", file ? { file } : {}, async () => {
      const s = await state()
      return aggregateDiagnosticsForTest(
        s.clients.map((c) => ({ serverID: c.serverID, diagnostics: c.diagnostics })),
        { file, now: Date.now() },
      )
    })
  }

  export async function hoverEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return metered("hover", { file: input.file }, async () =>
      runWithEnvelope(
        input.file,
        (client) =>
          withTimeout(
            client.connection.sendRequest("textDocument/hover", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            }),
            RPC_TIMEOUT_MS,
          ) as Promise<unknown>,
        (results) => (results as unknown[]).filter((r) => r !== null && r !== undefined),
        [] as unknown[],
        "hover",
        undefined,
        { mode: "semantic", method: "hover" },
      ),
    )
  }

  export async function hover(input: { file: string; line: number; character: number }) {
    const envelope = await hoverEnvelope(input)
    return envelope.data
  }

  enum SymbolKind {
    File = 1,
    Module = 2,
    Namespace = 3,
    Package = 4,
    Class = 5,
    Method = 6,
    Property = 7,
    Field = 8,
    Constructor = 9,
    Enum = 10,
    Interface = 11,
    Function = 12,
    Variable = 13,
    Constant = 14,
    String = 15,
    Number = 16,
    Boolean = 17,
    Array = 18,
    Object = 19,
    Key = 20,
    Null = 21,
    EnumMember = 22,
    Struct = 23,
    Event = 24,
    Operator = 25,
    TypeParameter = 26,
  }

  const kinds = [
    SymbolKind.Class,
    SymbolKind.Function,
    SymbolKind.Method,
    SymbolKind.Interface,
    SymbolKind.Variable,
    SymbolKind.Constant,
    SymbolKind.Struct,
    SymbolKind.Enum,
  ]

  // AI-facing result envelope. Per PRDs `LSP Reliability & Semantic Control
  // Plane v1` and `Semantic Trust Layer v1`, every AI-consumed semantic
  // result carries source/completeness/timestamp so downstream consumers can
  // reason about staleness and partial results without parsing log lines.
  //   data:         the wrapped payload; shape varies per operation.
  //   source:       "lsp"   — freshly fetched from a language server.
  //                 "cache" — served from code_intel_lsp_cache (S2). The
  //                           `timestamp` is preserved from the original LSP
  //                           fetch, not rewritten on each hit.
  //   completeness: "full"    — every participating client returned successfully.
  //                 "partial" — one or more servers failed and were skipped.
  //                 "empty"   — no server was matched for this request.
  //   timestamp:    wall-clock ms at response assembly time (or at the
  //                 original LSP fetch time, for cache hits; or the
  //                 code-graph index cursor time, for graph-sourced
  //                 results).
  //   serverIDs:    which servers contributed, for provenance/audit.
  //                 Empty array for graph-sourced envelopes.
  //   cacheKey:     opaque identifier of the cache row that served the
  //                 response; absent for live LSP responses. Surfaces in
  //                 audit rows (S3) so replay can assert cache-source
  //                 equality.
  //
  // Source semantics:
  //   "lsp"    — result came from a live language server query.
  //   "cache"  — result came from the content-addressable response cache.
  //   "graph"  — result came from the persistent code-graph index.
  //              Staleness is signalled via `timestamp` (= graph cursor
  //              last-indexed time) + `degraded`. Graph-sourced envelopes
  //              don't fall back to LSP; consumers that need live data
  //              should call the LSP tool directly.
  export type SemanticEnvelope<T> = {
    data: T
    source: "lsp" | "cache" | "graph"
    completeness: "full" | "partial" | "empty"
    timestamp: number
    serverIDs: string[]
    cacheKey?: string
    // True when any participating server errored with a non-
    // MethodNotFound failure, OR when the result is empty despite a
    // matching file type that should have had a server. Set at write
    // time. Downstream consumers use this as a single-bit warning
    // without parsing completeness semantics.
    degraded?: boolean
  }

  // Read-time freshness classification. Not stored on the envelope —
  // consumers that care about "how old is this hit" call this helper
  // with the envelope's timestamp. Thresholds chosen to match the
  // cache TTL (24h) so a cached row, at the extreme end of its life,
  // reads as `warm` rather than misleadingly `fresh`.
  export type Freshness = "fresh" | "warm" | "stale"
  const FRESH_THRESHOLD_MS = 60 * 1000
  const WARM_THRESHOLD_MS = 24 * 60 * 60 * 1000

  export function envelopeFreshness(envelope: { timestamp: number }, now: number = Date.now()): Freshness {
    const age = now - envelope.timestamp
    if (age < FRESH_THRESHOLD_MS) return "fresh"
    if (age < WARM_THRESHOLD_MS) return "warm"
    return "stale"
  }

  // Back-compat alias for the original workspaceSymbol-specific shape.
  // Existing tests and tool code read `envelope.symbols` via this alias;
  // the generic shape above is preferred for new surfaces. `degraded`
  // is optional to preserve back-compat for consumers reading the
  // original v1 shape.
  export type SymbolEnvelope = {
    symbols: LSP.Symbol[]
    source: "lsp"
    completeness: "full" | "partial" | "empty"
    timestamp: number
    serverIDs: string[]
    degraded?: boolean
  }

  // ─── LSP response cache integration (S2) ────────────────────────────
  //
  // Content-addressable cache fronting LSP.referencesEnvelope and
  // LSP.documentSymbolEnvelope. Gated by AX_CODE_LSP_CACHE.
  //
  // Key semantics live in code_intel_lsp_cache (see schema comment).
  // Here we just hash the file, look it up, and route hit vs miss to
  // the perf sampler with distinct operation labels so `perf:index`
  // can compute hit rate directly from the snapshot.
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24h; see PRD §S2 risk 4
  const CACHE_PRUNE_PROBABILITY = 0.01

  function cacheEnabled(override?: boolean): boolean {
    return override ?? Flag.AX_CODE_LSP_CACHE
  }

  async function hashFile(file: string): Promise<string | undefined> {
    try {
      // Persistent cache key — kept on Bun.hash for backwards compat
      // with cache entries written by older versions. Switching the
      // algorithm here would invalidate every existing user's LSP
      // cache on first run after upgrade. Not a correctness issue
      // (just a one-time miss) but unnecessary churn.
      const buf = await Bun.file(file).arrayBuffer()
      return Bun.hash(new Uint8Array(buf)).toString()
    } catch (err) {
      log.warn("cache: failed to hash file; skipping cache", { file, err: String(err) })
      return undefined
    }
  }

  // Try cache read. Returns a fully-formed envelope when hit, undefined
  // on miss (or when the cache is disabled / unavailable). The caller
  // is responsible for perf accounting — we pass `operation` here only
  // for the row lookup, not for sampler bookkeeping.
  function cacheLookup<T>(
    operation: LspCacheOperation,
    filePath: string,
    contentHash: string,
    line: number,
    character: number,
    enabled: boolean,
  ): SemanticEnvelope<T> | undefined {
    if (!enabled) return undefined
    let row: ReturnType<typeof CodeGraphQuery.getLspCache>
    try {
      row = CodeGraphQuery.getLspCache({
        projectID: Instance.project.id,
        operation,
        filePath,
        contentHash,
        line,
        character,
        now: Date.now(),
      })
    } catch (err) {
      log.warn("cache: lookup failed", { err: String(err) })
      return undefined
    }
    if (!row) return undefined

    try {
      CodeGraphQuery.incrementLspCacheHit(row.id)
    } catch {
      // Hit-count failure is not worth failing the request over.
    }

    return {
      data: row.payload_json as T,
      source: "cache",
      completeness: row.completeness,
      // Preserve the original LSP fetch timestamp so consumers can see
      // how stale a cache hit is. This is load-bearing for S3 replay.
      timestamp: row.time_created,
      serverIDs: row.server_ids_json,
      cacheKey: row.id,
      // Cache only stores full-completeness rows (see cacheWrite
      // guard). A cache hit therefore was not degraded at write time.
      // Freshness is computed read-time via envelopeFreshness(), not
      // written into this field.
      degraded: false,
    }
  }

  // Write a successful `full` LSP response to the cache. No-op when the
  // cache is disabled or when the result is partial/empty.
  function cacheWrite(
    operation: LspCacheOperation,
    filePath: string,
    contentHash: string,
    line: number,
    character: number,
    envelope: SemanticEnvelope<unknown>,
    enabled: boolean,
  ) {
    if (!enabled) return
    if (envelope.completeness !== "full") return

    const now = Date.now()
    try {
      CodeGraphQuery.upsertLspCache({
        projectID: Instance.project.id,
        operation,
        filePath,
        contentHash,
        line,
        character,
        payload: envelope.data,
        serverIDs: envelope.serverIDs,
        completeness: envelope.completeness,
        expiresAt: now + CACHE_TTL_MS,
      })
    } catch (err) {
      log.warn("cache: write failed", { err: String(err) })
      return
    }

    // Amortized TTL sweep. No background worker, no cron — every
    // successful write has a small chance of cleaning up after
    // abandoned rows. On an empty cache this is a near-no-op scan
    // against the code_intel_lsp_cache_expires_idx index.
    if (Math.random() < CACHE_PRUNE_PROBABILITY) {
      try {
        const removed = CodeGraphQuery.pruneExpiredLspCache(now)
        if (removed > 0) log.info("cache: pruned expired rows", { removed })
      } catch (err) {
        log.warn("cache: prune failed", { err: String(err) })
      }
    }
  }

  export async function workspaceSymbolEnvelope(query: string): Promise<SymbolEnvelope> {
    return metered("workspaceSymbol", { query }, async () => {
      const selectStarted = performance.now()
      let selection: ClientSelection
      try {
        selection = await getWorkspaceClientsDetailed({ mode: "semantic", method: "workspaceSymbol" })
      } catch (err) {
        finishPerfPhase("workspaceSymbol.select", selectStarted, false)
        throw err
      }
      const selectDurationMs = finishPerfPhase("workspaceSymbol.select", selectStarted, true)
      if (selection.freshSpawnCount > 0) {
        recordPerf("workspaceSymbol.select.spawned", selectDurationMs, true)
      }

      const clients = selection.clients
      if (clients.length === 0) {
        return {
          symbols: [],
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
      let result: LSP.Symbol[][]
      try {
        result = await Promise.all(
          clients.map((client) =>
            withTimeout(
              client.connection.sendRequest("workspace/symbol", {
                query,
              }),
              RPC_TIMEOUT_LONG_MS,
            )
              .then((result) => {
                participatingServerIDs.push(client.serverID)
                return (result as LSP.Symbol[]).filter((x: LSP.Symbol) => kinds.includes(x.kind))
              })
              .catch((err) => {
                // A linter LSP attached to the same file type may not
                // implement workspace/symbol — treat MethodNotFound as
                // "not participating", not as a partial-completeness
                // downgrade.
                if (!isMethodNotFound(err)) {
                  failures++
                  log.warn("LSP client failed in workspaceSymbol", { serverID: client.serverID, err })
                }
                return [] as LSP.Symbol[]
              }),
          ),
        )
        finishPerfPhase("workspaceSymbol.rpc", rpcStarted, failures === 0)
      } catch (err) {
        finishPerfPhase("workspaceSymbol.rpc", rpcStarted, false)
        throw err
      }

      const seen = new Set<string>()
      const symbols = result
        .flat()
        .filter((symbol): symbol is LSP.Symbol => Boolean(symbol))
        .filter((symbol) => {
          const key = [
            symbol.name,
            symbol.kind,
            symbol.location.uri,
            symbol.location.range.start.line,
            symbol.location.range.start.character,
            symbol.location.range.end.line,
            symbol.location.range.end.character,
          ].join(":")
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        .slice(0, 10)

      const completeness: "full" | "partial" | "empty" =
        participatingServerIDs.length === 0 ? "empty" : failures === 0 ? "full" : "partial"
      const degraded = failures > 0 || participatingServerIDs.length === 0

      return {
        symbols,
        source: "lsp",
        completeness,
        timestamp: Date.now(),
        serverIDs: participatingServerIDs,
        degraded,
      }
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

  // Explicit cache probes used by callers that want to avoid the live LSP
  // path entirely when a content-addressed answer already exists. These do
  // not fall through to a server on miss.
  export async function documentSymbolCachedEnvelope(
    uri: string,
  ): Promise<SemanticEnvelope<(LSP.DocumentSymbol | LSP.Symbol)[]> | undefined> {
    const file = fileURLToPath(uri)
    const contentHash = await hashFile(file)
    if (!contentHash) return undefined
    const hit = cacheLookup<(LSP.DocumentSymbol | LSP.Symbol)[]>("documentSymbol", file, contentHash, -1, -1, true)
    if (hit) recordPerf("documentSymbol.cached", 0, true)
    return hit
  }

  export async function documentSymbolEnvelope(
    uri: string,
    opts?: {
      cache?: boolean
    },
  ): Promise<SemanticEnvelope<(LSP.DocumentSymbol | LSP.Symbol)[]>> {
    const file = fileURLToPath(uri)
    const useCache = cacheEnabled(opts?.cache)
    return metered("documentSymbol", { file }, async () => {
      // Hash the file once per call; used by both the cache (when
      // enabled) and the in-flight dedup (always). A few hundred μs
      // per call is a flat cost that's recouped many times over the
      // moment two concurrent calls collapse into one LSP RPC.
      const contentHash = await hashFile(file)

      if (contentHash && useCache) {
        const hit = await documentSymbolCachedEnvelope(uri)
        if (hit) return hit
      }

      const dedupKey = contentHash ? `documentSymbol:${file}:${contentHash}` : undefined
      const envelope = await runWithEnvelope(
        file,
        (client) =>
          withTimeout(
            client.connection.sendRequest("textDocument/documentSymbol", {
              textDocument: { uri },
            }),
            RPC_TIMEOUT_MS,
          ) as Promise<(LSP.DocumentSymbol | LSP.Symbol)[]>,
        (results) => results.flat().filter(Boolean) as (LSP.DocumentSymbol | LSP.Symbol)[],
        [] as (LSP.DocumentSymbol | LSP.Symbol)[],
        "documentSymbol",
        dedupKey,
        { mode: "semantic", method: "documentSymbol" },
      )

      recordPerf("documentSymbol.live", 0, true)
      if (contentHash && useCache) {
        cacheWrite("documentSymbol", file, contentHash, -1, -1, envelope, useCache)
      }
      return envelope
    })
  }

  export async function documentSymbol(uri: string) {
    const envelope = await documentSymbolEnvelope(uri)
    return envelope.data
  }

  export async function definitionEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return metered("definition", { file: input.file }, async () =>
      runWithEnvelope(
        input.file,
        (client) =>
          withTimeout(
            client.connection.sendRequest("textDocument/definition", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            }),
            RPC_TIMEOUT_MS,
          ) as Promise<unknown>,
        (results) => (results as unknown[]).flat().filter(Boolean),
        [] as unknown[],
        "definition",
        undefined,
        { mode: "semantic", method: "definition" },
      ),
    )
  }

  export async function definition(input: { file: string; line: number; character: number }) {
    const envelope = await definitionEnvelope(input)
    return envelope.data
  }

  export async function referencesCachedEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]> | undefined> {
    const contentHash = await hashFile(input.file)
    if (!contentHash) return undefined
    const hit = cacheLookup<unknown[]>("references", input.file, contentHash, input.line, input.character, true)
    if (hit) recordPerf("references.cached", 0, true)
    return hit
  }

  export async function referencesEnvelope(input: {
    file: string
    line: number
    character: number
    cache?: boolean
  }): Promise<SemanticEnvelope<unknown[]>> {
    const useCache = cacheEnabled(input.cache)
    return metered("references", { file: input.file }, async () => {
      const contentHash = await hashFile(input.file)

      if (contentHash && useCache) {
        const hit = await referencesCachedEnvelope(input)
        if (hit) return hit
      }

      const dedupKey = contentHash
        ? `references:${input.file}:${contentHash}:${input.line}:${input.character}`
        : undefined

      const envelope = await runWithEnvelope(
        input.file,
        (client) =>
          withTimeout(
            client.connection.sendRequest("textDocument/references", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
              context: { includeDeclaration: true },
            }),
            RPC_TIMEOUT_MS,
          ) as Promise<unknown>,
        (results) => (results as unknown[]).flat().filter(Boolean),
        [] as unknown[],
        "references",
        dedupKey,
        { mode: "semantic", method: "references" },
      )

      recordPerf("references.live", 0, true)
      if (contentHash && useCache) {
        cacheWrite("references", input.file, contentHash, input.line, input.character, envelope, useCache)
      }
      return envelope
    })
  }

  export async function references(input: { file: string; line: number; character: number }) {
    const envelope = await referencesEnvelope(input)
    return envelope.data
  }

  export async function implementation(input: { file: string; line: number; character: number }) {
    const envelope = await implementationEnvelope(input)
    return envelope.data
  }

  export async function implementationEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return metered("implementation", { file: input.file }, async () =>
      runWithEnvelope(
        input.file,
        (client) =>
          withTimeout(
            client.connection.sendRequest("textDocument/implementation", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            }),
            RPC_TIMEOUT_MS,
          ) as Promise<unknown>,
        (results) => (results as unknown[]).flat().filter(Boolean),
        [] as unknown[],
        "implementation",
        undefined,
        { mode: "semantic", method: "implementation" },
      ),
    )
  }

  export async function prepareCallHierarchy(input: { file: string; line: number; character: number }) {
    const envelope = await prepareCallHierarchyEnvelope(input)
    return envelope.data
  }

  export async function prepareCallHierarchyEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return metered("prepareCallHierarchy", { file: input.file }, async () =>
      runWithEnvelope(
        input.file,
        (client) =>
          withTimeout(
            client.connection.sendRequest("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            }),
            RPC_TIMEOUT_MS,
          ) as Promise<unknown>,
        (results) => (results as unknown[]).flat().filter(Boolean),
        [] as unknown[],
        "prepareCallHierarchy",
        undefined,
        { mode: "semantic", method: "callHierarchy" },
      ),
    )
  }

  export async function incomingCalls(input: { file: string; line: number; character: number }) {
    const envelope = await incomingCallsEnvelope(input)
    return envelope.data
  }

  export async function incomingCallsEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return metered("incomingCalls", { file: input.file }, async () =>
      runWithEnvelope(
        input.file,
        async (client) => {
          const items = (await withTimeout(
            client.connection.sendRequest("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            }),
            RPC_TIMEOUT_MS,
          )) as unknown[]
          if (!items?.length) return []
          return withTimeout(client.connection.sendRequest("callHierarchy/incomingCalls", { item: items[0] }), RPC_TIMEOUT_MS)
        },
        (results) => (results as unknown[]).flat().filter(Boolean),
        [] as unknown[],
        "incomingCalls",
        undefined,
        { mode: "semantic", method: "callHierarchy" },
      ),
    )
  }

  export async function outgoingCalls(input: { file: string; line: number; character: number }) {
    const envelope = await outgoingCallsEnvelope(input)
    return envelope.data
  }

  export async function outgoingCallsEnvelope(input: {
    file: string
    line: number
    character: number
  }): Promise<SemanticEnvelope<unknown[]>> {
    return metered("outgoingCalls", { file: input.file }, async () =>
      runWithEnvelope(
        input.file,
        async (client) => {
          const items = (await withTimeout(
            client.connection.sendRequest("textDocument/prepareCallHierarchy", {
              textDocument: { uri: pathToFileURL(input.file).href },
              position: { line: input.line, character: input.character },
            }),
            RPC_TIMEOUT_MS,
          )) as unknown[]
          if (!items?.length) return []
          return withTimeout(client.connection.sendRequest("callHierarchy/outgoingCalls", { item: items[0] }), RPC_TIMEOUT_MS)
        },
        (results) => (results as unknown[]).flat().filter(Boolean),
        [] as unknown[],
        "outgoingCalls",
        undefined,
        { mode: "semantic", method: "callHierarchy" },
      ),
    )
  }

  // Per-client catch so one failing LSP client (e.g. gopls crashed
  // mid-request) doesn't reject the whole Promise.all and discard
  // results from every other healthy language server. The callback's
  // own .catch wrappers handle timeout errors, but the `input` callable
  // itself can throw (null connection, sendRequest error) before
  // reaching those catches — this wrapper catches that case.
  async function runAll<T>(input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await state().then((x) => x.clients)
    const tasks = clients.map((x) =>
      input(x).catch((err) => {
        log.warn("LSP client failed in runAll", { serverID: x.serverID, err })
        return undefined
      }),
    )
    return (await Promise.all(tasks)).filter((r): r is Awaited<T> => r !== undefined) as T[]
  }

  async function run<T>(file: string, input: (client: LSPClient.Info) => Promise<T>): Promise<T[]> {
    const clients = await getClients(file)
    const tasks = clients.map((x) =>
      input(x).catch((err) => {
        log.warn("LSP client failed in run", { serverID: x.serverID, err })
        return undefined
      }),
    )
    return (await Promise.all(tasks)).filter((r): r is Awaited<T> => r !== undefined) as T[]
  }

  // Envelope-producing variant of run(). Unlike run(), this reports
  // per-client failures so SemanticEnvelope.completeness can be computed
  // ("full" if every participating client succeeded, "partial" if any
  // failed, "empty" if no client was matched). Callers reduce the
  // successful per-client results into a single payload and hand the
  // reduction back via `reduce`.
  // JSON-RPC method-not-found. A polyglot project may have multiple
  // LSP servers attached to the same file (e.g. typescript + eslint);
  // linters typically don't implement semantic methods like
  // textDocument/references. MethodNotFound on one server does NOT
  // mean the result is partial — the server in question simply
  // doesn't participate in this method. Treat it as a skip, not a
  // failure.
  const LSP_ERROR_METHOD_NOT_FOUND = -32601

  function isMethodNotFound(err: unknown): boolean {
    if (typeof err !== "object" || err === null) return false
    const code = (err as { code?: unknown }).code
    return code === LSP_ERROR_METHOD_NOT_FOUND
  }

  async function runWithEnvelope<TClient, TPayload>(
    file: string,
    call: (client: LSPClient.Info) => Promise<TClient>,
    reduce: (results: TClient[]) => TPayload,
    empty: TPayload,
    operation: string,
    dedupKey?: string,
    opts: ClientOptions = {},
  ): Promise<SemanticEnvelope<TPayload>> {
    // Duplicate-request collapse (Semantic Trust v2 §S1). When dedupKey
    // is supplied and matches an in-flight call, return the same
    // promise — second caller gets identical envelope, identical
    // cacheKey, no extra RPC. Callers that can't cheaply compute the
    // key (e.g. hover/definition which don't content-hash the file)
    // pass undefined and skip dedup. That's acceptable because hover/
    // definition calls are rare compared to references/documentSymbol.
    if (dedupKey) {
      return LspScheduler.Inflight.run(dedupKey, () =>
        runWithEnvelopeUncollapsed(file, call, reduce, empty, operation, opts),
      )
    }
    return runWithEnvelopeUncollapsed(file, call, reduce, empty, operation, opts)
  }

  async function runWithEnvelopeUncollapsed<TClient, TPayload>(
    file: string,
    call: (client: LSPClient.Info) => Promise<TClient>,
    reduce: (results: TClient[]) => TPayload,
    empty: TPayload,
    operation: string,
    opts: ClientOptions = {},
  ): Promise<SemanticEnvelope<TPayload>> {
    const selectStarted = performance.now()
    let selection: ClientSelection
    try {
      selection = await getClientsDetailed(file, opts)
    } catch (err) {
      finishPerfPhase(`${operation}.select`, selectStarted, false)
      throw err
    }
    const selectDurationMs = finishPerfPhase(`${operation}.select`, selectStarted, true)
    if (selection.freshSpawnCount > 0) {
      recordPerf(`${operation}.select.spawned`, selectDurationMs, true)
    }

    const clients = selection.clients
    if (clients.length === 0) {
      return {
        data: empty,
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
        clients.map(async (c) => {
          // Per-server concurrency budget (§S2). Blocks if the server
          // is at cap; caller sees normal queued latency, never more
          // than ACQUIRE_TIMEOUT_MS of wait before converting to a
          // one-client failure. Release is in finally so crashes don't
          // leak slots.
          let release: () => void
          try {
            release = await LspScheduler.Budget.acquire(c.serverID)
          } catch (err) {
            failures++
            log.warn("LSP budget acquire failed in runWithEnvelope", {
              serverID: c.serverID,
              err: err instanceof Error ? err.message : String(err),
            })
            return undefined
          }
          try {
            const result = await call(c)
            participatingServerIDs.push(c.serverID)
            return result
          } catch (err) {
            if (isMethodNotFound(err)) {
              // Server doesn't implement this method — not a failure,
              // just not participating. Don't count against completeness
              // and don't attribute to serverIDs (provenance is about
              // who actually contributed data).
              return undefined
            }
            failures++
            log.warn("LSP client failed in runWithEnvelope", { serverID: c.serverID, err })
            return undefined
          } finally {
            release()
          }
        }),
      )
      finishPerfPhase(`${operation}.rpc`, rpcStarted, failures === 0)
    } catch (err) {
      finishPerfPhase(`${operation}.rpc`, rpcStarted, false)
      throw err
    }

    const successful = perClient.filter((r): r is Awaited<TClient> => r !== undefined) as TClient[]
    // If every server that could have contributed failed, the result
    // is empty, not partial. This preserves the semantic difference
    // between "no one had anything to say" (empty) and "some subset
    // answered, others errored" (partial).
    const completeness: "full" | "partial" | "empty" =
      participatingServerIDs.length === 0
        ? "empty"
        : failures === 0
          ? "full"
          : "partial"
    // degraded = any non-MethodNotFound failure, OR no server
    // participated when the file type matched at least one server
    // (the clients.length check above already short-circuits the
    // "no matching server" case to plain empty; here, if we still
    // got to zero participants, it means every matched server
    // errored or returned MethodNotFound — a degraded state).
    const degraded = failures > 0 || participatingServerIDs.length === 0
    return {
      data: reduce(successful),
      source: "lsp",
      completeness,
      timestamp: Date.now(),
      serverIDs: participatingServerIDs,
      degraded,
    }
  }

  export namespace Diagnostic {
    export function pretty(diagnostic: LSPClient.Diagnostic) {
      const severityMap = {
        1: "ERROR",
        2: "WARN",
        3: "INFO",
        4: "HINT",
      }

      const severity = severityMap[diagnostic.severity ?? 1]
      const line = diagnostic.range.start.line + 1
      const col = diagnostic.range.start.character + 1

      return `${severity} [${line}:${col}] ${diagnostic.message}`
    }
  }
}
