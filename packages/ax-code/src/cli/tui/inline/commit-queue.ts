import { scheduleTuiTimeout } from "../util/timer"

export type Commit = { key: string; progress?: boolean }

/** Only adjacent, not-yet-started progress snapshots may replace each other. */
export function createCommitQueue<T extends Commit>(
  write: (block: T) => void | Promise<void>,
  onError: (error: unknown) => void = () => {},
  options: { progressBatchMs?: number } = {},
) {
  const pending: T[] = []
  let chain = Promise.resolve()
  let scheduled = false
  let closed = false
  let active = false
  let cancelBatch: (() => void) | undefined
  const flush = (): Promise<void> => {
    cancelBatch?.()
    cancelBatch = undefined
    if (!scheduled) {
      scheduled = true
      chain = chain.then(async () => {
        try {
          while (pending.length) {
            const block = pending.shift()!
            active = true
            try {
              await write(block)
            } catch (error) {
              try {
                onError(error)
              } catch {
                /* Reporting must not poison the queue. */
              }
            } finally {
              active = false
            }
          }
        } finally {
          scheduled = false
        }
      })
    }
    return chain
  }
  return {
    enqueue(block: T) {
      if (closed) return false
      const last = pending.at(-1)
      if (last?.progress && block.progress && last.key === block.key) pending[pending.length - 1] = block
      else pending.push(block)
      // Only progress may wait. A final block, decision, error or close drains
      // the whole FIFO immediately, so batching cannot reorder the transcript.
      if (block.progress && options.progressBatchMs && !scheduled) {
        cancelBatch ??= scheduleTuiTimeout(
          () => {
            cancelBatch = undefined
            return flush()
          },
          { name: "inline.scrollback-batch", delayMs: options.progressBatchMs, unref: true },
        )
      } else void flush()
      return true
    },
    flush,
    close() {
      closed = true
      return flush()
    },
    get size() {
      return pending.length + Number(active)
    },
  }
}
