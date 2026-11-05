import type { HeadlessRuntimeProbeKey } from "@/runtime/headless/event"
import { parseIntegerEnv } from "../util/env"
import { withTimeout } from "@/util/timeout"

export interface RuntimeSyncProbeHandlers {
  syncMcpStatus: () => Promise<void> | void
  syncLspStatus: () => Promise<void> | void
  syncDebugEngine: () => Promise<void> | void
  syncWorkflowDashboard?: () => Promise<void> | void
  onWarn: (label: string, error: unknown) => void
}

export type RuntimeSyncProbeKey = HeadlessRuntimeProbeKey

export interface RuntimeSyncProbeTask {
  key: RuntimeSyncProbeKey
  label: string
  run: () => Promise<void> | void
  onWarn: (label: string, error: unknown) => void
}

const RUNTIME_PROBE_LABEL: Record<RuntimeSyncProbeKey, string> = {
  mcp: "mcp status sync failed",
  lsp: "lsp status sync failed",
  "debug-engine": "debug engine sync failed",
  workflow: "workflow dashboard sync failed",
}

export function runtimeSyncProbeTask(
  key: RuntimeSyncProbeKey,
  handlers: RuntimeSyncProbeHandlers,
): RuntimeSyncProbeTask {
  return {
    key,
    label: RUNTIME_PROBE_LABEL[key],
    run: runtimeProbeRunner(key, handlers),
    onWarn: handlers.onWarn,
  }
}

export const DEFAULT_RUNTIME_SYNC_PROBE_DELAY_MS = 750
export const AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS = "AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS"

export interface RuntimeSyncProbeScheduler {
  schedule: (task: RuntimeSyncProbeTask) => void
  dispose: () => void
}

export function createRuntimeSyncProbeScheduler(
  input: {
    delayMs?: number
    env?: Record<string, string | undefined>
    onCoalesced?: (key: RuntimeSyncProbeKey) => void
    setTimeoutFn?: (handler: () => void, timeout: number) => NodeJS.Timeout
    clearTimeoutFn?: (handle: NodeJS.Timeout) => void
  } = {},
): RuntimeSyncProbeScheduler {
  const delayMs =
    input.delayMs ??
    parseIntegerEnv({
      env: input.env ?? process.env,
      name: AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS,
      fallback: DEFAULT_RUNTIME_SYNC_PROBE_DELAY_MS,
      min: 0,
    })
  const setTimeoutFn =
    input.setTimeoutFn ?? ((handler: () => void, timeout: number) => setTimeout(handler, timeout) as NodeJS.Timeout)
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout
  const queued = new Map<RuntimeSyncProbeKey, RuntimeSyncProbeTask>()
  const queuedAfterInFlight = new Map<RuntimeSyncProbeKey, RuntimeSyncProbeTask>()
  const inFlight = new Set<RuntimeSyncProbeKey>()
  const abort = new AbortController()
  let timer: NodeJS.Timeout | undefined
  let disposed = false

  const start = (task: RuntimeSyncProbeTask) => {
    if (disposed) return
    if (inFlight.has(task.key)) {
      if (queuedAfterInFlight.has(task.key)) input.onCoalesced?.(task.key)
      queuedAfterInFlight.set(task.key, task)
      return
    }

    inFlight.add(task.key)
    void runRuntimeSyncProbe(task, abort.signal).finally(() => {
      inFlight.delete(task.key)
      const next = queuedAfterInFlight.get(task.key)
      queuedAfterInFlight.delete(task.key)
      if (next && !disposed) schedule(next)
    })
  }

  const flush = () => {
    timer = undefined
    const tasks = Array.from(queued.values())
    queued.clear()
    for (const task of tasks) start(task)
  }

  const schedule = (task: RuntimeSyncProbeTask) => {
    if (disposed) return
    if (inFlight.has(task.key)) {
      if (queuedAfterInFlight.has(task.key)) input.onCoalesced?.(task.key)
      queuedAfterInFlight.set(task.key, task)
      return
    }
    if (queued.has(task.key)) input.onCoalesced?.(task.key)
    queued.set(task.key, task)
    if (timer) return
    timer = setTimeoutFn(flush, delayMs)
  }

  return {
    schedule,
    dispose() {
      disposed = true
      abort.abort()
      if (timer) clearTimeoutFn(timer)
      timer = undefined
      queued.clear()
      queuedAfterInFlight.clear()
    },
  }
}

async function runRuntimeSyncProbe(input: RuntimeSyncProbeTask, signal: AbortSignal) {
  let cancel!: () => void
  const cancelled = new Promise<void>((resolve) => {
    cancel = resolve
    signal.addEventListener("abort", cancel, { once: true })
  })
  try {
    if (signal.aborted) return
    // A disconnected request may never settle. Release its coalescing key so
    // later events can refresh it, and clear this deadline when disposed.
    await withTimeout(Promise.race([Promise.resolve(input.run()), cancelled]), 10_000, `${input.label}: timed out`, {
      unref: true,
    })
  } catch (error) {
    if (!signal.aborted) input.onWarn(input.label, error)
  } finally {
    signal.removeEventListener("abort", cancel)
  }
}

function runtimeProbeRunner(key: RuntimeSyncProbeKey, handlers: RuntimeSyncProbeHandlers) {
  switch (key) {
    case "mcp":
      return handlers.syncMcpStatus
    case "lsp":
      return handlers.syncLspStatus
    case "debug-engine":
      return handlers.syncDebugEngine
    case "workflow":
      return handlers.syncWorkflowDashboard ?? (() => undefined)
  }
}
