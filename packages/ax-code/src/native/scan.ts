import { WorkQueue } from "@ax-code/util/work-queue"

const queue = new WorkQueue(2, { maxQueued: 32, timeoutMs: 120_000 })

/** Cancellation is cooperative; queue slots outlive the caller's abort. */
export function runNativeScan<T>(
  createCancellation: () => { cancel(): void },
  run: (cancellation: { cancel(): void }) => Promise<T>,
  signal?: AbortSignal,
) {
  return queue.run(async (workSignal) => {
    workSignal.throwIfAborted()
    const cancellation = createCancellation()
    const cancel = () => cancellation.cancel()
    workSignal.addEventListener("abort", cancel, { once: true })
    try {
      const value = await run(cancellation)
      workSignal.throwIfAborted()
      return value
    } finally {
      workSignal.removeEventListener("abort", cancel)
    }
  }, signal)
}
