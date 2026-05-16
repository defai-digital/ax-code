import type { BootstrapPhaseSequenceStep, BootstrapSpan } from "./sync-bootstrap-runner"
import type { BootstrapTask } from "./sync-bootstrap-task"

export type SyncBootstrapStatus = "loading" | "partial" | "complete"

export function createSyncBootstrapPhaseSequence(input: {
  blockingTasks: BootstrapTask[]
  coreTasks: BootstrapTask[]
  deferredTasks: BootstrapTask[]
  deferredDelayMs?: number
  deferredConcurrency?: number
  deferredBackground?: boolean
  getStatus: () => SyncBootstrapStatus
  setStatus: (status: SyncBootstrapStatus) => void
  finishCoreSpan?: BootstrapSpan
  finishDeferredSpan?: BootstrapSpan
  finishStartup: () => void
  logWarn: (label: string, data: { error: string }) => void
  logError: (label: string, data: { error: string }) => void
  recordStartup: (name: string, data?: Record<string, unknown>) => void
}): BootstrapPhaseSequenceStep[] {
  const hasBlockingTasks = input.blockingTasks.length > 0

  return [
    {
      tasks: input.blockingTasks,
      onRejected(error) {
        input.logWarn("blocking bootstrap item failed", { error })
      },
      after() {
        if (!hasBlockingTasks) return
        if (input.getStatus() !== "loading") return
        input.setStatus("partial")
        input.recordStartup("tui.startup.syncPartial")
      },
    },
    {
      tasks: input.coreTasks,
      onRejected(error) {
        input.logError("core bootstrap item failed", { error })
      },
      onSettled(summary) {
        input.recordStartup("tui.startup.bootstrapCoreReady", { rejected: summary.rejected.length })
      },
      finishSpan: input.finishCoreSpan,
      after() {
        input.setStatus("complete")
        // Startup is interactive once core state is ready. Deferred runtime
        // probes continue as background work so they cannot hold the first
        // prompt hostage on packaged stdio backends.
        input.finishStartup()
      },
    },
    {
      tasks: input.deferredTasks,
      delayMs: input.deferredDelayMs,
      concurrency: input.deferredConcurrency,
      background: input.deferredBackground ?? true,
      onRejected(error) {
        input.logError("deferred bootstrap item failed", { error })
      },
      onSettled(summary) {
        input.recordStartup("tui.startup.bootstrapDeferredReady", { rejected: summary.rejected.length })
      },
      finishSpan: input.finishDeferredSpan,
    },
  ]
}
