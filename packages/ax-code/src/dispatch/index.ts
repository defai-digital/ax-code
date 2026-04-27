/**
 * Subagent Dispatcher
 *
 * Effect-free primitive that fans a unit of work out to multiple subagents
 * in parallel and returns a typed result for each. Decoupled from the agent
 * runtime via an injected `DispatchExecutor` so tests don't need Provider /
 * Agent / AI SDK plumbing.
 *
 * Scope (ADR-005 P0): parallel fan-out, per-spec timeout, parent AbortSignal
 * propagation, structured results. Out of scope here: Permission integration,
 * Bus event emission, race / majority merge strategies, worktree isolation.
 * Those land as separate follow-ups when there's a concrete use case.
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

export interface DispatchOptions {
  /** Max number of concurrent subagents. Defaults to 3. */
  maxParallel?: number
  /** Parent AbortSignal — when it fires, all in-flight subagents are aborted. */
  signal?: AbortSignal
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

  const maxParallel = Math.max(1, options.maxParallel ?? DEFAULT_MAX_PARALLEL)
  const results: DispatchResult[] = []

  for (let i = 0; i < specs.length; i += maxParallel) {
    if (options.signal?.aborted) {
      // Parent already cancelled — emit cancelled stubs for every remaining
      // spec so the caller sees a complete result array indexed by input.
      for (const spec of specs.slice(i)) {
        results.push(cancelled(spec))
      }
      break
    }
    const batch = specs.slice(i, i + maxParallel)
    const batchResults = await Promise.all(batch.map((spec) => runOne(spec, executor, options)))
    results.push(...batchResults)
  }

  log.info("dispatch complete", {
    count: specs.length,
    completed: results.filter((r) => r.status === "completed").length,
    failed: results.filter((r) => r.status === "failed").length,
    timeout: results.filter((r) => r.status === "timeout").length,
    cancelled: results.filter((r) => r.status === "cancelled").length,
  })

  return results
}

async function runOne(
  spec: DispatchSpec,
  executor: DispatchExecutor,
  options: DispatchOptions,
): Promise<DispatchResult> {
  const start = Date.now()
  options.onSubagentStart?.(spec)

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
    options.onSubagentComplete?.(result)
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
    options.onSubagentComplete?.(result)
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
