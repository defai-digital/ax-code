export type RuntimeSyncEvent =
  | { type: "mcp.tools.changed" }
  | { type: "lsp.updated" }
  | { type: "code.index.progress" }
  | { type: "code.index.state" }
  | { type: "vcs.branch.updated"; properties: { branch: string } }

export interface RuntimeSyncEventHandlers {
  syncMcpStatus: () => Promise<void> | void
  syncLspStatus: () => Promise<void> | void
  syncDebugEngine: () => Promise<void> | void
  setVcsBranch: (branch: string) => void
  onWarn: (label: string, error: unknown) => void
  scheduleProbe?: RuntimeSyncProbeScheduler["schedule"]
}

export type RuntimeSyncProbeKey = "mcp" | "lsp" | "debug-engine"

export interface RuntimeSyncProbeTask {
  key: RuntimeSyncProbeKey
  label: string
  run: () => Promise<void> | void
  onWarn: (label: string, error: unknown) => void
}

export const DEFAULT_RUNTIME_SYNC_PROBE_DELAY_MS = 750
export const AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS = "AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS"

function parseRuntimeSyncProbeDelayMs(env: Record<string, string | undefined>) {
  const value = env[AX_CODE_TUI_RUNTIME_SYNC_PROBE_DELAY_MS]
  if (!value) return DEFAULT_RUNTIME_SYNC_PROBE_DELAY_MS
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_RUNTIME_SYNC_PROBE_DELAY_MS
}

export interface RuntimeSyncProbeScheduler {
  schedule: (task: RuntimeSyncProbeTask) => void
  dispose: () => void
}

export function createRuntimeSyncProbeScheduler(input: {
  delayMs?: number
  env?: Record<string, string | undefined>
  onCoalesced?: (key: RuntimeSyncProbeKey) => void
  setTimeoutFn?: (handler: () => void, timeout: number) => ReturnType<typeof setTimeout>
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void
} = {}): RuntimeSyncProbeScheduler {
  const delayMs = input.delayMs ?? parseRuntimeSyncProbeDelayMs(input.env ?? process.env)
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

function syncWithWarning(task: RuntimeSyncProbeTask, scheduleProbe: RuntimeSyncEventHandlers["scheduleProbe"]) {
  if (scheduleProbe) {
    scheduleProbe(task)
    return
  }
  void runRuntimeSyncProbe(task)
}

export function handleRuntimeSyncEvent(event: RuntimeSyncEvent, handlers: RuntimeSyncEventHandlers) {
  switch (event.type) {
    case "mcp.tools.changed":
      syncWithWarning(
        { key: "mcp", label: "mcp status sync failed", run: handlers.syncMcpStatus, onWarn: handlers.onWarn },
        handlers.scheduleProbe,
      )
      return true

    case "lsp.updated":
      syncWithWarning(
        { key: "lsp", label: "lsp status sync failed", run: handlers.syncLspStatus, onWarn: handlers.onWarn },
        handlers.scheduleProbe,
      )
      syncWithWarning(
        {
          key: "debug-engine",
          label: "debug engine sync failed",
          run: handlers.syncDebugEngine,
          onWarn: handlers.onWarn,
        },
        handlers.scheduleProbe,
      )
      return true

    case "code.index.progress":
    case "code.index.state":
      syncWithWarning(
        {
          key: "debug-engine",
          label: "debug engine sync failed",
          run: handlers.syncDebugEngine,
          onWarn: handlers.onWarn,
        },
        handlers.scheduleProbe,
      )
      return true

    case "vcs.branch.updated":
      handlers.setVcsBranch(event.properties.branch)
      return true
  }
}
