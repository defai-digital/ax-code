import type { BootstrapTask } from "./sync-bootstrap-task"

export interface BootstrapPhaseSummary {
  rejected: string[]
}

export async function settleBootstrapPhase(
  tasks: BootstrapTask[],
  input?: {
    onRejected?: (error: string) => void
  },
): Promise<BootstrapPhaseSummary> {
  const results = await Promise.allSettled(tasks.map((task) => Promise.resolve().then(task)))
  const rejected = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => String(result.reason))

  for (const error of rejected) {
    input?.onRejected?.(error)
  }

  return { rejected }
}
