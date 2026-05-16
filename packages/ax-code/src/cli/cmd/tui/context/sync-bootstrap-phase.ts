import type { BootstrapTask } from "./sync-bootstrap-task"

export interface BootstrapPhaseSummary {
  rejected: string[]
}

export async function settleBootstrapPhase(
  tasks: BootstrapTask[],
  input?: {
    onRejected?: (error: string) => void
    concurrency?: number
  },
): Promise<BootstrapPhaseSummary> {
  const concurrency = normalizeBootstrapPhaseConcurrency(input?.concurrency, tasks.length)
  const rejected = !concurrency
    ? await settleBootstrapPhaseConcurrent(tasks)
    : await settleBootstrapPhaseLimited(tasks, concurrency)

  for (const error of rejected) {
    input?.onRejected?.(error)
  }

  return { rejected }
}

function normalizeBootstrapPhaseConcurrency(value: number | undefined, taskCount: number) {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return
  if (taskCount <= 1 || value >= taskCount) return
  return value
}

async function settleBootstrapPhaseConcurrent(tasks: BootstrapTask[]) {
  const results = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)))
  return results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String(result.reason))
}

async function settleBootstrapPhaseLimited(tasks: BootstrapTask[], concurrency: number) {
  const limit = Math.max(1, Math.floor(concurrency))
  const rejectedByIndex: Array<string | undefined> = []
  let cursor = 0

  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (true) {
        const index = cursor++
        if (index >= tasks.length) return
        try {
          await Promise.resolve().then(tasks[index]!)
        } catch (error) {
          rejectedByIndex[index] = String(error)
        }
      }
    }),
  )

  return rejectedByIndex.filter((error): error is string => typeof error === "string")
}
