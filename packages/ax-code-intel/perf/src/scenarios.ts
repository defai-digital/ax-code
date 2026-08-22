// The six Phase 0 scenarios (PRD §4). Each drives the real production path —
// server defs spawn the process, LSPClient handles the protocol, and queries
// go through the same point/references modules the facade uses — while the
// harness keeps the process handle for RSS polling and RPC counting.
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { LSPClient } from "../../src/client"
import * as LSPPerf from "../../src/perf"
import * as LSPPoint from "../../src/point"
import * as LSPReferences from "../../src/references"
import type { ClientSelection } from "../../src/selection"
import type { LSPServer } from "../../src/server"
import type { FixtureDescriptor } from "./fixtures"
import type { ScenarioResult } from "./metrics"
import { ratio, round, summarizeDurations } from "./metrics"
import { captureStderr, formatError, killTree, pollPeakRss, withDeadline } from "./spawn"

export type ScenarioProfile = {
  coldStarts: number
  warmupQueries: number
  warmQueries: number
  diagnosticIterations: number
}

export const SMOKE_PROFILE: ScenarioProfile = {
  coldStarts: 3,
  warmupQueries: 5,
  warmQueries: 20,
  diagnosticIterations: 5,
}

export const FULL_PROFILE: ScenarioProfile = {
  coldStarts: 5,
  warmupQueries: 10,
  warmQueries: 50,
  diagnosticIterations: 10,
}

export type ScenarioContext = {
  fixture: FixtureDescriptor
  workDir: string
  server: LSPServer.Info
  profile: ScenarioProfile
  queryTimeoutMs: number
  coldStartTimeoutMs: number
}

export const SCENARIO_NAMES = [
  "cold-start",
  "warm-query",
  "peak-rss",
  "cache-hit-rate",
  "diagnostic-latency",
  "graph-builder",
] as const
export type ScenarioName = (typeof SCENARIO_NAMES)[number]

const exited = (handle: LSPServer.Handle) => () =>
  handle.process.exitCode !== null || handle.process.signalCode !== null

// LSPClient.create with two guards the production client deliberately does
// not have (its internal timeout is unref'd and a dead server can leave a
// pending initialize unsettled):
//  1. an early-exit race — a server whose process dies before answering
//     initialize fails fast instead of hanging until the deadline;
//  2. a ref'd outer deadline — the harness always finishes deliberately.
// Every failure is annotated with the server's captured stderr tail, which
// is where startup failures (broken proxies, missing components) are
// actually reported.
function createClient(ctx: ScenarioContext, handle: LSPServer.Handle): Promise<LSPClient.Info> {
  const stderr = captureStderr(handle.process)
  const earlyExit = new Promise<never>((_resolve, reject) => {
    handle.process.once("exit", (code, signal) => {
      reject(new Error(`${ctx.server.id} exited during initialize (code=${code} signal=${signal})`))
    })
  })
  const created = Promise.race([
    LSPClient.create({ serverID: ctx.server.id, server: handle, root: ctx.workDir }),
    earlyExit,
  ])
  return withDeadline(created, ctx.coldStartTimeoutMs, `cold start (${ctx.server.id})`).catch((err: unknown) => {
    const tail = stderr.tail()
    throw new Error(formatError(err) + (tail ? `\nserver stderr:\n${tail}` : ""))
  })
}

export type ProbeResult = { ok: true } | { ok: false; reason: string }

// LSP-handshake preflight: verifies the one thing the harness needs — the
// server spawns and answers initialize in this workdir. A `--version` flag
// probe both misfires (pyright-langserver has no such flag and exits
// non-zero without a transport argument) and says nothing about whether the
// server actually speaks LSP here.
export async function probeServer(ctx: ScenarioContext): Promise<ProbeResult> {
  const handle = await ctx.server.spawn(ctx.workDir).catch(() => undefined)
  if (!handle) {
    return { ok: false, reason: "spawn returned no process (binary not on PATH, or the server def declined to spawn)" }
  }
  try {
    const client = await createClient(ctx, handle)
    await client.shutdown().catch(() => killTree(handle.process, { exited: exited(handle) }))
    return { ok: true }
  } catch (err) {
    await killTree(handle.process, { exited: exited(handle) })
    return { ok: false, reason: formatError(err) }
  }
}

// Spawn → initialize → run → shutdown, with guaranteed teardown on every
// failure path. Returns undefined when the server binary cannot spawn at all
// (preflight should have caught this; the guard keeps a partial environment
// from crashing the whole run).
async function withServerClient<T>(
  ctx: ScenarioContext,
  fn: (client: LSPClient.Info, handle: LSPServer.Handle) => Promise<T>,
): Promise<T | undefined> {
  const handle = await ctx.server.spawn(ctx.workDir)
  if (!handle) return undefined
  let client: LSPClient.Info
  try {
    client = await createClient(ctx, handle)
  } catch (err) {
    await killTree(handle.process, { exited: exited(handle) })
    throw err
  }
  try {
    return await fn(client, handle)
  } finally {
    await client.shutdown().catch(() => killTree(handle.process, { exited: exited(handle) }))
  }
}

const selectOnly = (client: LSPClient.Info) => async (): Promise<ClientSelection> => ({
  clients: [client],
  freshSpawnCount: 0,
})

const editComment = (language: FixtureDescriptor["language"]) =>
  language === "py" ? "# ax-code-perf edit" : "// ax-code-perf edit"

function base(
  ctx: ScenarioContext,
  scenario: string,
): Pick<ScenarioResult, "scenario" | "fixture" | "language" | "serverId"> {
  return { scenario, fixture: ctx.fixture.id, language: ctx.fixture.language, serverId: ctx.server.id }
}

// S1 — cold start: fresh process, initialize handshake, wall time, teardown.
export async function coldStart(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const durations: number[] = []
  for (let i = 0; i < ctx.profile.coldStarts; i++) {
    const started = performance.now()
    const handle = await ctx.server.spawn(ctx.workDir)
    if (!handle) return []
    let client: LSPClient.Info
    try {
      client = await createClient(ctx, handle)
    } catch (err) {
      await killTree(handle.process, { exited: exited(handle) })
      throw err
    }
    const durationMs = Math.round(performance.now() - started)
    durations.push(durationMs)
    LSPPerf.recordSample(`perf.cold-start.${ctx.server.id}`, durationMs, true)
    await client.shutdown().catch(() => killTree(handle.process, { exited: exited(handle) }))
  }
  return [{ ...base(ctx, "cold-start"), ...summarizeDurations(durations) }]
}

// S2 + S3 — warm queries (hover/definition/references steady-state p50/p95)
// wrapped in a peak-RSS poller on the server process. One server lifetime
// serves both scenarios so the RSS sample covers exactly the measured load.
export async function warmQuery(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const result = await withServerClient(ctx, async (client, handle) => {
    const runtime = { timeoutMs: ctx.queryTimeoutMs, selectClients: selectOnly(client) }
    const toPoint = (q: FixtureDescriptor["queries"]["hover"][number]) => ({
      file: path.join(ctx.workDir, q.file),
      line: q.line,
      character: q.character,
    })
    const methods = [
      {
        name: "hover",
        points: ctx.fixture.queries.hover.map(toPoint),
        run: (p: LSPPoint.PointInput) => LSPPoint.hover(p, runtime),
      },
      {
        name: "definition",
        points: ctx.fixture.queries.definition.map(toPoint),
        run: (p: LSPPoint.PointInput) => LSPPoint.definition(p, runtime),
      },
      {
        name: "references",
        points: ctx.fixture.queries.references.map(toPoint),
        run: (p: LSPPoint.PointInput) => LSPReferences.references(p, runtime),
      },
    ]

    // Open every file the queries touch so results reflect steady state.
    const queryFiles = new Set(methods.flatMap((m) => m.points.map((p) => p.file)))
    for (const file of queryFiles) {
      await client.notify.open({ path: file })
    }

    // Readiness gate: servers that answer while still loading the workspace
    // (rust-analyzer returns empty results until its crate graph is up)
    // would otherwise record fast-but-empty garbage. Poll the pinned queries
    // until every method returns results or the cold-start budget expires.
    const readinessDeadline = Date.now() + ctx.coldStartTimeoutMs
    for (;;) {
      const counts = await Promise.all(
        methods.map(async (method) => {
          const result = await method.run(method.points[0]!).catch(() => [] as unknown[])
          return result.length
        }),
      )
      if (counts.every((count) => count > 0)) break
      if (Date.now() >= readinessDeadline) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }

    const poller = pollPeakRss(handle.process.pid)
    try {
      // Warmup iterations are discarded.
      for (let i = 0; i < ctx.profile.warmupQueries; i++) {
        for (const method of methods) {
          await method.run(method.points[i % method.points.length]!).catch(() => undefined)
        }
      }

      const durations: Record<string, number[]> = { hover: [], definition: [], references: [] }
      for (let i = 0; i < ctx.profile.warmQueries; i++) {
        for (const method of methods) {
          const started = performance.now()
          const ok = await method
            .run(method.points[i % method.points.length]!)
            .then(() => true)
            .catch(() => false)
          const durationMs = Math.round(performance.now() - started)
          durations[method.name]!.push(durationMs)
          LSPPerf.recordSample(`perf.warm-query.${method.name}.${ctx.server.id}`, durationMs, ok)
        }
      }

      const peakRssKb = await poller.stop()
      if (peakRssKb !== undefined) LSPPerf.recordPeakRss(`perf.peak-rss.${ctx.server.id}`, peakRssKb)

      const results: ScenarioResult[] = methods.map((method) => ({
        ...base(ctx, `warm-query:${method.name}`),
        ...summarizeDurations(durations[method.name]!),
      }))
      const all = Object.values(durations).flat()
      results.push({
        ...base(ctx, "peak-rss"),
        samples: all.length,
        p50: 0,
        p95: 0,
        ...(peakRssKb !== undefined ? { peakRssKb } : {}),
        totalMs: round(all.reduce((sum, value) => sum + value, 0)),
      })
      return results
    } finally {
      await poller.stop()
    }
  })
  return result ?? []
}

// S4 — cache hit rate for the cache-probe path, against the harness host's
// in-memory store: warm pass (misses), repeat pass (hits), one-line edit
// (miss), repeat (re-hit). Counts come from the perf ring buffer the probe
// already records into ("references.cached" / "references.live").
export async function cacheHitRate(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const result = await withServerClient(ctx, async (client) => {
    const runtime = { timeoutMs: ctx.queryTimeoutMs, selectClients: selectOnly(client) }
    const points = ctx.fixture.queries.references.map((q) => ({
      file: path.join(ctx.workDir, q.file),
      line: q.line,
      character: q.character,
    }))
    const queryFile = path.join(ctx.workDir, ctx.fixture.queries.references[0]!.file)
    await client.notify.open({ path: queryFile })

    const pass = async (count: number) => {
      for (let i = 0; i < count; i++) {
        await LSPReferences.references({ ...points[i % points.length]!, cache: true }, runtime).catch(() => undefined)
      }
    }

    const started = performance.now()
    await pass(ctx.profile.warmQueries) // cold: fills the store
    LSPPerf.reset() // only measured passes count toward the hit rate
    await pass(ctx.profile.warmQueries) // expect hits

    const original = await readFile(queryFile, "utf8")
    try {
      await writeFile(queryFile, `${original}\n${editComment(ctx.fixture.language)}\n`, "utf8")
      await pass(ctx.profile.warmQueries) // hash changed: expect misses
      await pass(ctx.profile.warmQueries) // expect re-hits
    } finally {
      await writeFile(queryFile, original, "utf8")
    }
    const totalMs = Math.round(performance.now() - started)

    const snap = LSPPerf.snapshot()
    const hits = snap["references.cached"]?.count ?? 0
    const misses = snap["references.live"]?.count ?? 0
    const hitRate = ratio(hits, hits + misses)
    return [
      {
        ...base(ctx, "cache-hit-rate"),
        samples: hits + misses,
        p50: 0,
        p95: 0,
        ...(hitRate !== undefined ? { hitRate: round(hitRate) } : {}),
        totalMs,
      },
    ] satisfies ScenarioResult[]
  })
  return result ?? []
}

// S5 — diagnostic latency after an edit, measured two ways depending on
// server capability:
//
//  - Pull mode (LSP 3.17 `textDocument/diagnostic`, what the PRD names):
//    after each didChange, request the document's diagnostic report and
//    time the response. Request/response is strictly ordered, so this is
//    immune to the push channel's async coalescing. Supported servers:
//    pyright, rust-analyzer.
//  - Push mode (fallback): poll the client's diagnostics cache until the
//    published state flips to the expected one. Used for
//    typescript-language-server, which has no pull support. Polling the
//    cache instead of subscribing to "textDocument/publishDiagnostics" is
//    deliberate: vscode-jsonrpc keeps a single handler per method, so a
//    harness subscription would replace the client's own handler (and leave
//    none behind after dispose), breaking its diagnostics bookkeeping.
//
// Each iteration toggles the fixture's diagnostic edit line, which
// introduces a severity-1 error. Matching checks for the presence of an
// *error* — not "any diagnostic" — because real-world files legitimately
// carry pre-existing warnings/hints (e.g. zod's schemas.ts publishes 16
// deprecation hints for the unedited file). LSP defaults a missing severity
// to Error, hence `?? 1`. Edits go through the production notify path. A
// state that never materializes records the 10 s cap.
const DIAGNOSTIC_PUBLISH_TIMEOUT_MS = 10_000
const DIAGNOSTIC_POLL_INTERVAL_MS = 25
const LSP_METHOD_NOT_FOUND = -32601
const SEVERITY_ERROR = 1

const hasErrorDiagnostic = (items: readonly { severity?: number }[]) =>
  items.some((item) => (item.severity ?? SEVERITY_ERROR) === SEVERITY_ERROR)

type DiagnosticReport = { kind?: string; items?: unknown[] }

export async function diagnosticLatency(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const result = await withServerClient(ctx, async (client) => {
    const file = path.join(ctx.workDir, ctx.fixture.diagnosticFile)
    const fileUri = pathToFileURL(file).href
    const original = await readFile(file, "utf8")
    const editLine = ctx.fixture.diagnosticEditLine || editComment(ctx.fixture.language)
    const broken = `${original}\n${editLine}\n`
    const durations: number[] = []

    // PERF_DEBUG=1 logs per-iteration state transitions — the first thing to
    // reach for when a server's diagnostic latency looks like a timeout cap.
    const debug = process.env.PERF_DEBUG === "1"

    // One pull request with retries around transient server-busy
    // cancellations (rust-analyzer answers -32802 while still loading).
    const pullReport = async (): Promise<DiagnosticReport> => {
      let lastError: unknown
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          return (await withDeadline(
            client.connection.sendRequest("textDocument/diagnostic", { textDocument: { uri: fileUri } }),
            DIAGNOSTIC_PUBLISH_TIMEOUT_MS,
            "textDocument/diagnostic",
          )) as DiagnosticReport
        } catch (err) {
          lastError = err
          if ((err as { code?: number })?.code === LSP_METHOD_NOT_FOUND) break
          await new Promise((resolve) => setTimeout(resolve, 250))
        }
      }
      throw lastError
    }

    // Probe pull support once. Method-not-found means push mode; anything
    // else (busy, cancelled) just retries.
    let pull = true
    try {
      await pullReport()
    } catch (err) {
      if ((err as { code?: number })?.code === LSP_METHOD_NOT_FOUND) {
        pull = false
      } else {
        throw err
      }
    }
    if (debug) console.log(`    [s5] mode=${pull ? "pull" : "push"}`)

    const awaitDiagnosticFlip = async (expectErrors: boolean): Promise<boolean> => {
      const deadline = Date.now() + DIAGNOSTIC_PUBLISH_TIMEOUT_MS
      for (;;) {
        const diags = client.diagnostics.get(file)
        if (diags !== undefined && hasErrorDiagnostic(diags) === expectErrors) return true
        if (Date.now() >= deadline) return false
        await new Promise((resolve) => setTimeout(resolve, DIAGNOSTIC_POLL_INTERVAL_MS))
      }
    }

    try {
      // Cold open: wait (best-effort, production 3s budget) for the initial
      // publish so iterations start from a settled state.
      await client.notify.open({ path: file, waitForDiagnostics: true })
      for (let i = 0; i < ctx.profile.diagnosticIterations; i++) {
        const expectErrors = i % 2 === 0
        const started = performance.now()
        await writeFile(file, expectErrors ? broken : original, "utf8")
        await client.notify.open({ path: file })
        let ok: boolean
        if (pull) {
          const report = await pullReport().catch(() => undefined)
          const items = report?.kind === "full" ? (report.items ?? []) : undefined
          ok = items !== undefined && hasErrorDiagnostic(items as { severity?: number }[]) === expectErrors
        } else {
          ok = await awaitDiagnosticFlip(expectErrors)
        }
        const durationMs = Math.round(performance.now() - started)
        if (debug) {
          console.log(
            `    [s5] iter ${i} expectErrors=${expectErrors} ${ok ? "matched" : "MISMATCH/TIMEOUT"} ${durationMs}ms`,
          )
        }
        durations.push(durationMs)
        LSPPerf.recordSample(`perf.diagnostic-latency.${ctx.server.id}`, durationMs, ok)
      }
    } finally {
      await writeFile(file, original, "utf8")
    }
    return [{ ...base(ctx, "diagnostic-latency"), ...summarizeDurations(durations) }]
  })
  return result ?? []
}

// Count every LSP message sent over a client's connection by wrapping
// sendRequest/sendNotification. Used by the graph-builder scenario to
// quantify the LSP fan-out of a touch-driven crawl.
function installRpcCounter(client: LSPClient.Info): { readonly count: number; restore: () => void } {
  const connection = client.connection
  const state = { count: 0 }
  const sendRequest = connection.sendRequest.bind(connection) as (...args: unknown[]) => Promise<unknown>
  const sendNotification = connection.sendNotification.bind(connection) as (...args: unknown[]) => Promise<void>
  connection.sendRequest = ((...args: unknown[]) => {
    state.count++
    return sendRequest(...args)
  }) as unknown as typeof connection.sendRequest
  connection.sendNotification = ((...args: unknown[]) => {
    state.count++
    return sendNotification(...args)
  }) as unknown as typeof connection.sendNotification
  return {
    get count() {
      return state.count
    },
    restore() {
      connection.sendRequest = sendRequest as unknown as typeof connection.sendRequest
      connection.sendNotification = sendNotification as unknown as typeof connection.sendNotification
    },
  }
}

// S6 — graph-builder fan-out: touch up to 200 source files the server owns
// (sorted for determinism; the cap matches the PRD's N=200 and bounds the
// crawl on large external repos) and record per-file wall time plus total
// LSP round-trips. Stands in for the core graph builder's LSP crawl (which
// drives the same notify path).
const GRAPH_BUILDER_MAX_FILES = 200

export async function graphBuilder(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const result = await withServerClient(ctx, async (client) => {
    const extensions = new Set(ctx.server.extensions)
    const files = Object.keys(ctx.fixture.files)
      .filter((rel) => extensions.has(path.extname(rel)))
      .sort()
      .slice(0, GRAPH_BUILDER_MAX_FILES)
      .map((rel) => path.join(ctx.workDir, rel))
    const counter = installRpcCounter(client)
    const durations: number[] = []
    try {
      for (const file of files) {
        const started = performance.now()
        const ok = await client.notify
          .open({ path: file })
          .then(() => true)
          .catch(() => false)
        const durationMs = Math.round(performance.now() - started)
        durations.push(durationMs)
        LSPPerf.recordSample(`perf.graph-builder.touch.${ctx.server.id}`, durationMs, ok)
      }
    } finally {
      counter.restore()
    }
    const summary = summarizeDurations(durations)
    LSPPerf.recordSample(`perf.graph-builder.${ctx.server.id}`, summary.totalMs, true)
    return [{ ...base(ctx, "graph-builder"), ...summary, rpcCount: counter.count }]
  })
  return result ?? []
}

export async function runScenario(name: ScenarioName, ctx: ScenarioContext): Promise<ScenarioResult[]> {
  switch (name) {
    case "cold-start":
      return coldStart(ctx)
    case "warm-query":
      return (await warmQuery(ctx)).filter((r) => r.scenario !== "peak-rss")
    case "peak-rss":
      return (await warmQuery(ctx)).filter((r) => r.scenario === "peak-rss")
    case "cache-hit-rate":
      return cacheHitRate(ctx)
    case "diagnostic-latency":
      return diagnosticLatency(ctx)
    case "graph-builder":
      return graphBuilder(ctx)
  }
}

// All six scenarios in dependency-friendly order: peak-rss rides along with
// warm-query, so the "run everything" path calls warmQuery once.
export async function runAllScenarios(ctx: ScenarioContext): Promise<ScenarioResult[]> {
  const results: ScenarioResult[] = []
  results.push(...(await coldStart(ctx)))
  results.push(...(await warmQuery(ctx)))
  results.push(...(await cacheHitRate(ctx)))
  results.push(...(await diagnosticLatency(ctx)))
  results.push(...(await graphBuilder(ctx)))
  return results
}
