/**
 * Silence watchdog extracted verbatim from event-pipeline.ts. The timer is
 * armed lazily on the first reset() (i.e. the first observed stream activity)
 * and re-armed on every subsequent activity; it fires onTimeout after
 * `timeoutMs` of silence. A heartbeat is never armed before the stream has
 * produced anything — connect-phase timeouts are the driver's job.
 */

export type Heartbeat = {
  reset(): void
  clear(): void
}

export function createHeartbeat(timeoutMs: number, onTimeout: () => void): Heartbeat {
  let timer: ReturnType<typeof setTimeout> | undefined

  return {
    reset() {
      if (timer) clearTimeout(timer)
      timer = setTimeout(onTimeout, timeoutMs)
    },
    clear() {
      if (!timer) return
      clearTimeout(timer)
      timer = undefined
    },
  }
}
