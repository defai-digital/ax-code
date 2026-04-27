/**
 * Subagent Dispatcher
 *
 * Effect-free primitive that fans a unit of work out to multiple subagents
 * in parallel and returns a typed result for each. Decoupled from the agent
 * runtime via an injected `DispatchExecutor` so tests don't need Provider /
 * Agent / AI SDK plumbing.
 *
 * Scope (ADR-005 P0): parallel fan-out, per-spec timeout, parent AbortSignal
 * propagation, structured results, merge strategies (`all` / `first-success`
 * / `majority`), and an injectable event sink for the session layer to
 * adapt into Bus events. Out of scope here: Tool registration, worktree
 * isolation. Those land as separate follow-ups (P1+).
 */

import { Log } from "../util/log"

const log = Log.create({ service: "dispatch" })

const DEFAULT_MAX_PARALLEL = 3
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

export interface DispatchSpec {
  /** Agent name as registered in agent/agent.ts. */
  agent: string
  /** Task description handed to the subagent. */
  prompt: string
  /** Soft requirements (typically from `Question.toConstraints`). */
  constraints?: string[]
  /** Per-spec timeout. Defaults to 5 minutes. */
  timeoutMs?: number
}

export type DispatchStatus = "completed" | "failed" | "timeout" | "cancelled"

export interface DispatchResult {
  agent: string
  status: DispatchStatus
  output?: string
  error?: string
  durationMs: number
  filesModified: string[]
  tokensUsed: number
}

/** Subset of DispatchResult that an executor must produce on success. */
export interface ExecutorOutput {
  output?: string
  filesModified?: string[]
  tokensUsed?: number
}

/**
 * Function that executes a single subagent. Provided by the caller — typically
 * the session layer wraps Provider + Agent + tool runtime here.
 *
 * The executor MUST honor `signal` and abort gracefully when it fires; the
 * dispatcher uses it to enforce timeouts and propagate parent cancellation.
 */
export type DispatchExecutor = (spec: DispatchSpec, signal: AbortSignal) => Promise<ExecutorOutput>

/**
 * Merge strategy controls when the dispatcher considers itself "done":
 *
 *  - `all`:           wait for every spec; never auto-cancel (default).
 *  - `first-success`: as soon as any spec returns `completed`, cancel the
 *                     rest. Useful for "race two analysers".
 *  - `majority`:      once more than half of specs have returned
 *                     `completed`, cancel the rest. Critic-style consensus.
 *
 * Specs cancelled by the strategy come back with `status: "cancelled"`.
 */
export type MergeStrategy = "all" | "first-success" | "majority"

/**
 * Optional event sink for the session layer to adapt into Bus events.
 * The dispatcher does NOT depend on Bus directly so it can be unit-tested
 * without the session-layer plumbing.
 */
export interface DispatcherEventSink {
  onDispatchStart?: (specs: DispatchSpec[]) => void
  onSubagentStart?: (spec: DispatchSpec) => void
  onSubagentComplete?: (result: DispatchResult) => void
  onDispatchComplete?: (results: DispatchResult[]) => void
}

export interface DispatchOptions {
  /** Max number of concurrent subagents. Defaults to 3. */
  maxParallel?: number
  /** Parent AbortSignal — when it fires, all in-flight subagents are aborted. */
  signal?: AbortSignal
  /** Merge strategy controlling early termination. Defaults to `"all"`. */
  mergeStrategy?: MergeStrategy
  /** Per-call event sink — translated to Bus events by the session layer. */
  events?: DispatcherEventSink
  onSubagentStart?: (spec: DispatchSpec) => void
  onSubagentComplete?: (result: DispatchResult) => void
}

/**
 * Run `specs` in parallel batches of at most `maxParallel`. Each subagent
 * gets its own AbortSignal that fires on per-spec timeout OR on the parent
 * signal. All results are returned regardless of individual success/failure
 * — the caller aggregates.
 */
export async function dispatch(
  specs: DispatchSpec[],
  executor: DispatchExecutor,
  options: DispatchOptions = {},
): Promise<DispatchResult[]> {
  if (specs.length === 0) return []

  // Defensive: NaN bypasses Math.max comparisons and breaks the for-loop
  // step; clamp to default. Negative or zero clamp to 1.
  const rawMax = options.maxParallel
  const maxParallel =
    rawMax === undefined || !Number.isFinite(rawMax) ? DEFAULT_MAX_PARALLEL : Math.max(1, Math.floor(rawMax))
  const merge: MergeStrategy = options.mergeStrategy ?? "all"

  safeCallback(options.events?.onDispatchStart, specs, "events.onDispatchStart")

  const results =
    merge === "all"
      ? await dispatchAll(specs, executor, options, maxParallel)
      : await dispatchUntil(specs, executor, options, maxParallel, merge)

  log.info("dispatch complete", {
    count: specs.length,
    mergeStrategy: merge,
    completed: results.filter((r) => r.status === "completed").length,
    failed: results.filter((r) => r.status === "failed").length,
    timeout: results.filter((r) => r.status === "timeout").length,
    cancelled: results.filter((r) => r.status === "cancelled").length,
  })

  safeCallback(options.events?.onDispatchComplete, results, "events.onDispatchComplete")
  return results
}

/** Wait-for-all batched dispatch — the legacy behavior. */
async function dispatchAll(
  specs: DispatchSpec[],
  executor: DispatchExecutor,
  options: DispatchOptions,
  maxParallel: number,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = []
  for (let i = 0; i < specs.length; i += maxParallel) {
    if (options.signal?.aborted) {
      // Parent already cancelled — emit cancelled stubs for every remaining
      // spec so the caller sees a complete result array indexed by input.
      for (const spec of specs.slice(i)) results.push(cancelled(spec))
      break
    }
    const batch = specs.slice(i, i + maxParallel)
    const batchResults = await Promise.all(batch.map((spec) => runOne(spec, executor, options)))
    results.push(...batchResults)
  }
  return results
}

/**
 * Run all specs up to `maxParallel` at a time, watching for the merge
 * strategy's trigger condition. On trigger, the local AbortController
 * cancels still-running specs (their results come back as `cancelled`)
 * and any not-yet-started specs are emitted as cancelled stubs.
 *
 * The result array preserves input order regardless of completion order.
 */
async function dispatchUntil(
  specs: DispatchSpec[],
  executor: DispatchExecutor,
  options: DispatchOptions,
  maxParallel: number,
  merge: Exclude<MergeStrategy, "all">,
): Promise<DispatchResult[]> {
  const target = merge === "first-success" ? 1 : Math.floor(specs.length / 2) + 1
  const localAc = new AbortController()
  const combinedSignal = combineSignals(options.signal, localAc.signal)
  const results: (DispatchResult | undefined)[] = new Array(specs.length).fill(undefined)
  let completedCount = 0
  let nextIndex = 0
  let inflight = 0

  return new Promise<DispatchResult[]>((resolve) => {
    const finalize = () => {
      // Backfill any spec that never started with a cancelled stub so the
      // result array is complete and order-preserving.
      for (let i = 0; i < specs.length; i++) {
        if (!results[i]) results[i] = cancelled(specs[i]!)
      }
      resolve(results as DispatchResult[])
    }

    const launchNext = () => {
      // Stop spawning when the trigger fired or parent aborted.
      if (localAc.signal.aborted || options.signal?.aborted) {
        if (inflight === 0) finalize()
        return
      }
      while (inflight < maxParallel && nextIndex < specs.length) {
        const idx = nextIndex++
        const spec = specs[idx]!
        inflight++
        runOne(spec, executor, { ...options, signal: combinedSignal })
          .then((result) => {
            results[idx] = result
            inflight--
            if (result.status === "completed") {
              completedCount++
              if (completedCount >= target) localAc.abort()
            }
            if (nextIndex >= specs.length && inflight === 0) {
              finalize()
            } else {
              launchNext()
            }
          })
          .catch((err) => {
            // runOne is supposed to never throw — every error becomes a
            // result. Be defensive: log and treat as failed so we don't
            // hang the dispatch.
            log.warn("runOne threw unexpectedly", { agent: spec.agent, error: String(err) })
            results[idx] = {
              agent: spec.agent,
              status: "failed",
              error: err instanceof Error ? err.message : String(err),
              filesModified: [],
              tokensUsed: 0,
              durationMs: 0,
            }
            inflight--
            if (nextIndex >= specs.length && inflight === 0) finalize()
            else launchNext()
          })
      }
      if (specs.length === 0) finalize()
    }

    if (options.signal?.aborted) {
      finalize()
      return
    }
    launchNext()
  })
}

/**
 * Build a derived AbortSignal that aborts when any of `parents` aborts.
 * Returns a no-op (never-abort) signal when all parents are undefined.
 */
function combineSignals(...parents: (AbortSignal | undefined)[]): AbortSignal {
  const real = parents.filter((s): s is AbortSignal => s !== undefined)
  if (real.length === 0) return new AbortController().signal
  const ac = new AbortController()
  for (const s of real) {
    if (s.aborted) {
      ac.abort()
      return ac.signal
    }
    s.addEventListener("abort", () => ac.abort(), { once: true })
  }
  return ac.signal
}

function safeCallback<T>(fn: ((arg: T) => void) | undefined, arg: T, label: string): void {
  if (!fn) return
  try {
    fn(arg)
  } catch (err) {
    // Caller-supplied callbacks must not be allowed to crash the whole
    // dispatch — log and continue. The contract is "all results returned".
    log.warn("dispatch callback threw", { label, error: String(err) })
  }
}

async function runOne(
  spec: DispatchSpec,
  executor: DispatchExecutor,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const start = Date.now()
  safeCallback(options.onSubagentStart, spec, "onSubagentStart")
  safeCallback(options.events?.onSubagentStart, spec, "events.onSubagentStart")

  // Local AC fires on per-spec timeout; we forward the parent signal so the
  // caller can cancel the whole dispatch in one place.
  const localAc = new AbortController()
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS
  // Track whether *we* aborted (timeout) vs the parent aborted (cancelled).
  // The flag is set BEFORE aborting localAc so the catch block can tell
  // them apart — both reasons abort the same signal.
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    localAc.abort()
  }, timeoutMs)

  let parentAbortHandler: (() => void) | undefined
  if (options.signal) {
    if (options.signal.aborted) localAc.abort()
    else {
      parentAbortHandler = () => localAc.abort()
      options.signal.addEventListener("abort", parentAbortHandler, { once: true })
    }
  }

  try {
    const out = await executor(spec, localAc.signal)
    const result: DispatchResult = {
      agent: spec.agent,
      status: "completed",
      ...(out.output !== undefined ? { output: out.output } : {}),
      filesModified: out.filesModified ?? [],
      tokensUsed: out.tokensUsed ?? 0,
      durationMs: Date.now() - start,
    }
    safeCallback(options.onSubagentComplete, result, "onSubagentComplete")
    safeCallback(options.events?.onSubagentComplete, result, "events.onSubagentComplete")
    return result
  } catch (err) {
    // Disambiguate timeout vs parent-cancel vs ordinary throw. We track
    // `timedOut` explicitly because both reasons abort the same signal.
    const status: DispatchStatus = timedOut ? "timeout" : options.signal?.aborted ? "cancelled" : "failed"
    const result: DispatchResult = {
      agent: spec.agent,
      status,
      error: err instanceof Error ? err.message : String(err),
      filesModified: [],
      tokensUsed: 0,
      durationMs: Date.now() - start,
    }
    safeCallback(options.onSubagentComplete, result, "onSubagentComplete")
    safeCallback(options.events?.onSubagentComplete, result, "events.onSubagentComplete")
    return result
  } finally {
    clearTimeout(timer)
    if (parentAbortHandler && options.signal) {
      options.signal.removeEventListener("abort", parentAbortHandler)
    }
  }
}

function cancelled(spec: DispatchSpec): DispatchResult {
  return {
    agent: spec.agent,
    status: "cancelled",
    error: "parent dispatch cancelled before this spec started",
    filesModified: [],
    tokensUsed: 0,
    durationMs: 0,
  }
}
