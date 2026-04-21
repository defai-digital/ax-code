import { settleBootstrapPhase, type BootstrapPhaseSummary } from "./sync-bootstrap-phase"
import type { BootstrapTask } from "./sync-bootstrap-task"

export type BootstrapSpan = ((data?: Record<string, unknown>) => void) | undefined

export interface BootstrapLifecycle {
  startupSpan: BootstrapSpan
  createCoreSpan: () => BootstrapSpan
  createDeferredSpan: () => BootstrapSpan
  finishStartup: () => void
  fail: (error: unknown, ...spans: BootstrapSpan[]) => Promise<never>
}

export interface BootstrapPhaseTaskInput {
  tasks: BootstrapTask[]
  onRejected?: (error: string) => void
  onSettled?: (summary: BootstrapPhaseSummary) => void
  finishSpan?: BootstrapSpan
}

export interface BootstrapPhaseSequenceStep extends BootstrapPhaseTaskInput {
  after?: (summary: BootstrapPhaseSummary) => void | Promise<void>
}

export async function runBootstrapPhaseTasks(input: BootstrapPhaseTaskInput) {
  const summary = await settleBootstrapPhase(input.tasks, {
    onRejected: input.onRejected,
  })
  input.onSettled?.(summary)
  input.finishSpan?.({ rejected: summary.rejected.length })
  return summary
}

export async function runBootstrapPhaseSequence(steps: readonly BootstrapPhaseSequenceStep[]) {
  const summaries: BootstrapPhaseSummary[] = []

  for (const step of steps) {
    const summary = await runBootstrapPhaseTasks(step)
    await step.after?.(summary)
    summaries.push(summary)
  }

  return summaries
}

export function createBootstrapLifecycle(input: {
  isStartupBootstrap: boolean
  createSpan: (name: string) => Exclude<BootstrapSpan, undefined>
  onFailure: (error: unknown) => Promise<void> | void
}): BootstrapLifecycle {
  const startupSpan = input.isStartupBootstrap ? input.createSpan("tui.startup.bootstrap") : undefined

  function createNamedSpan(name: string): BootstrapSpan {
    return input.isStartupBootstrap ? input.createSpan(name) : undefined
  }

  return {
    startupSpan,
    createCoreSpan() {
      return createNamedSpan("tui.startup.bootstrapCore")
    },
    createDeferredSpan() {
      return createNamedSpan("tui.startup.bootstrapDeferred")
    },
    finishStartup() {
      startupSpan?.()
    },
    async fail(error, ...spans): Promise<never> {
      failBootstrapSpans(error, ...spans, startupSpan)
      try {
        await input.onFailure(error)
      } finally {
        throw error
      }
    },
  }
}

export function failBootstrapSpans(error: unknown, ...spans: BootstrapSpan[]) {
  const message = String(error)
  for (const span of spans) {
    span?.({ ok: false, error: message })
  }
}
