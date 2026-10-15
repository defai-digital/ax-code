export class WorkQueueFullError extends Error {
  constructor() {
    super("Work queue is full; retry after active work completes")
    this.name = "WorkQueueFullError"
  }
}

/** Bounded FIFO admission. Aborted work retains its slot until it settles. */
export class WorkQueue {
  private active = 0
  private waiters: Array<() => void> = []
  private readonly maxQueued: number
  private readonly timeoutMs: number
  private readonly drainOnAbort: boolean

  constructor(
    private readonly limit: number,
    options: { maxQueued?: number; timeoutMs?: number; drainOnAbort?: boolean } = {},
  ) {
    this.maxQueued = options.maxQueued ?? 64
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.drainOnAbort = options.drainOnAbort ?? false
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(this.maxQueued) ||
      this.maxQueued < 0 ||
      !Number.isFinite(this.timeoutMs) ||
      this.timeoutMs <= 0
    ) {
      throw new RangeError("Invalid work queue limits")
    }
  }

  async run<T>(fn: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.active >= this.limit && this.waiters.length >= this.maxQueued) throw new WorkQueueFullError()
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener("abort", abort, { once: true })
    const deadline = performance.now() + this.timeoutMs
    const workSignal = controller.signal
    const expire = () => {
      if (workSignal.aborted || performance.now() < deadline) return false
      controller.abort(new DOMException("Work deadline exceeded", "TimeoutError"))
      return true
    }
    const onDeadline = () => {
      if (expire() || workSignal.aborted) return
      timer = setTimeout(onDeadline, Math.min(deadline - performance.now(), 2_147_483_647))
    }
    // Node replaces delays above its signed 32-bit limit with 1 ms. Re-arm
    // long deadlines in bounded pieces instead of timing out immediately.
    let timer = setTimeout(onDeadline, Math.min(this.timeoutMs, 2_147_483_647))
    // Keep the timer ref'd: it is the only thing that settles `cancelled` when
    // a queued run cannot acquire a slot (or stalls with no OS handles). An
    // unref'd timer lets a short-lived process exit 13 silently instead of
    // rejecting with the timeout.
    let rejectAbort!: () => void
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(workSignal.reason)
      workSignal.addEventListener("abort", rejectAbort, { once: true })
    })
    // Lifecycle owners must observe completion only after owned resources are
    // cleaned up. They still remove queued work immediately on cancellation.
    if (this.drainOnAbort) void cancelled.catch(() => undefined)
    const execute = async () => {
      let acquired = false
      try {
        if (this.active >= this.limit) {
          await new Promise<void>((resolve, reject) => {
            const ready = () => {
              acquired = true // The previous operation transfers its slot.
              workSignal.removeEventListener("abort", remove)
              resolve()
            }
            const remove = () => {
              const index = this.waiters.indexOf(ready)
              if (index < 0) return
              this.waiters.splice(index, 1)
              reject(workSignal.reason)
            }
            this.waiters.push(ready)
            workSignal.addEventListener("abort", remove, { once: true })
          })
        } else {
          this.active++
          acquired = true
        }
        expire()
        workSignal.throwIfAborted()
        const result = await fn(workSignal)
        expire()
        workSignal.throwIfAborted()
        return result
      } catch (error) {
        if (expire()) throw workSignal.reason
        throw error
      } finally {
        if (acquired) {
          const next = this.waiters.shift()
          if (next) next()
          else this.active--
        }
      }
    }
    try {
      return await (this.drainOnAbort ? execute() : Promise.race([execute(), cancelled]))
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      workSignal.removeEventListener("abort", rejectAbort)
    }
  }
}
