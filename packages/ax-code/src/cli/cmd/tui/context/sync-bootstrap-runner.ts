import { formatBootstrapError, settleBootstrapPhase, type BootstrapPhaseSummary } from "./sync-bootstrap-phase"
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
  delayMs?: number
  concurrency?: number
  signal?: AbortSignal
  onRejected?: (error: string) => void
  onSettled?: (summary: BootstrapPhaseSummary) => void
  finishSpan?: BootstrapSpan
}

export interface BootstrapPhaseSequenceStep extends BootstrapPhaseTaskInput {
  background?: boolean
  after?: (summary: BootstrapPhaseSummary) => void | Promise<void>
}

export interface BootstrapPhaseSequenceOptions {
  signal?: AbortSignal
  scheduleBackground?: (run: () => Promise<BootstrapPhaseSummary>) => void
}

export async function runBootstrapPhaseTasks(input: BootstrapPhaseTaskInput) {
  if (input.signal?.aborted) {
    return emptyBootstrapPhaseSummary()
  }

  if (input.delayMs && input.delayMs > 0) {
    const completed = await waitBootstrapPhaseDelay(input.delayMs, input.signal)
    if (!completed || input.signal?.aborted) {
      return emptyBootstrapPhaseSummary()
    }
  }

  const summary = await settleBootstrapPhase(input.tasks, {
    onRejected: input.onRejected,
    concurrency: input.concurrency,
  })
  if (input.signal?.aborted) {
    return emptyBootstrapPhaseSummary()
  }
  input.onSettled?.(summary)
  input.finishSpan?.({ rejected: summary.rejected.length })
  return summary
}

export async function runBootstrapPhaseSequence(
  steps: readonly BootstrapPhaseSequenceStep[],
  options: BootstrapPhaseSequenceOptions = {},
) {
  const summaries: BootstrapPhaseSummary[] = []

  for (const step of steps) {
    if (options.signal?.aborted) {
      summaries.push(emptyBootstrapPhaseSummary())
      continue
    }

    if (step.background) {
      // Background phases are advisory refresh work. They should still
      // report their own task failures and finish spans, but they must not
      // keep the bootstrap controller's single-flight lock held after core
      // startup is already interactive.
      const run = () => {
        if (options.signal?.aborted) {
          return Promise.resolve(emptyBootstrapPhaseSummary())
        }
        return runBootstrapPhaseStep(step, options.signal).catch((error) => {
          const message = formatBootstrapError(error)
          step.onRejected?.(message)
          return { rejected: [message] }
        })
      }
      if (options.scheduleBackground) options.scheduleBackground(run)
      else void run()
      summaries.push(emptyBootstrapPhaseSummary())
      continue
    }

    const summary = await runBootstrapPhaseStep(step, options.signal)
    summaries.push(summary)
  }

  return summaries
}

async function runBootstrapPhaseStep(step: BootstrapPhaseSequenceStep, signal?: AbortSignal) {
  const phaseSignal = step.signal ?? signal
  const summary = await runBootstrapPhaseTasks({ ...step, signal: phaseSignal })
  if (phaseSignal?.aborted) {
    return summary
  }
  await step.after?.(summary)
  return summary
}

function emptyBootstrapPhaseSummary(): BootstrapPhaseSummary {
  return { rejected: [] }
}

function waitBootstrapPhaseDelay(delayMs: number, signal?: AbortSignal) {
  return new Promise<boolean>((resolve) => {
    if (signal?.aborted) {
      resolve(false)
      return
    }

    let timer: ReturnType<typeof setTimeout>
    const onAbort = () => {
      clearTimeout(timer)
      cleanup()
      resolve(false)
    }
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort)
    }

    timer = setTimeout(() => {
      cleanup()
      resolve(true)
    }, delayMs)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
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
  const message = formatBootstrapError(error)
  for (const span of spans) {
    span?.({ ok: false, error: message })
  }
}
