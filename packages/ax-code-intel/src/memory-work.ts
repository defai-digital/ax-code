import { memoryProfile } from "./prewarm-profile"
import { WorkQueue } from "@ax-code/util/work-queue"

export { WorkQueue } from "@ax-code/util/work-queue"

// Process-local bounds, not a machine-wide memory ceiling. Deadlines include
// admission; underlying RPC activity remains pinned until actual settlement.
const spawning = new WorkQueue(1, { maxQueued: 16, timeoutMs: 60_000, drainOnAbort: true })
const semantic = new WorkQueue(2)
export function memoryWork<T>(
  kind: "spawn" | "semantic",
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  return memoryProfile() === "low" ? (kind === "spawn" ? spawning : semantic).run(fn, signal) : fn(signal)
}
