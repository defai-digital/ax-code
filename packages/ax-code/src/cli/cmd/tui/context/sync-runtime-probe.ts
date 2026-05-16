import type { HeadlessRuntimeProbeKey } from "@/runtime/headless/event"
import { parseIntegerEnv } from "../util/env"

export interface RuntimeSyncProbeHandlers {
  syncMcpStatus: () => Promise<void> | void
  syncLspStatus: () => Promise<void> | void
  syncDebugEngine: () => Promise<void> | void
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
    setTimeoutFn?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>
    clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
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
  const setTimeoutFn = input.setTimeoutFn ?? setTimeout
  const clearTimeoutFn = input.clearTimeoutFn ?? clearTimeout
  const queued = new Map<RuntimeSyncProbeKey, RuntimeSyncProbeTask>()
  const queuedAfterInFlight = new Map<RuntimeSyncProbeKey, RuntimeSyncProbeTask>()
  const inFlight = new Set<RuntimeSyncProbeKey>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const start = (task: RuntimeSyncProbeTask) => {
    if (disposed) return
    if (inFlight.has(task.key)) {
      if (queuedAfterInFlight.has(task.key)) input.onCoalesced?.(task.key)
      queuedAfterInFlight.set(task.key, task)
      return
    }

    inFlight.add(task.key)
    void runRuntimeSyncProbe(task).finally(() => {
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
      if (timer) clearTimeoutFn(timer)
      timer = undefined
      queued.clear()
      queuedAfterInFlight.clear()
    },
  }
}

async function runRuntimeSyncProbe(input: RuntimeSyncProbeTask) {
  try {
    await Promise.resolve(input.run())
  } catch (error) {
    input.onWarn(input.label, error)
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
  }
}
