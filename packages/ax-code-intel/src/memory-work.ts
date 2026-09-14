import { memoryProfile } from "./prewarm-profile"

// Process-local FIFO admission. This limits operations, not resident language
// servers or total machine RAM. Queue delay is outside semantic RPC deadlines.
export class WorkQueue {
  private active = 0
  private waiters: Array<() => void> = []
  constructor(private readonly limit: number) {}
  async run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    if (this.active >= this.limit) {
      await new Promise<void>((resolve, reject) => {
        const ready = () => {
          signal?.removeEventListener("abort", abort)
          resolve()
        }
        const abort = () => {
          const index = this.waiters.indexOf(ready)
          if (index < 0) return
          this.waiters.splice(index, 1)
          reject(signal?.reason ?? new Error("LSP work cancelled"))
        }
        this.waiters.push(ready)
        signal?.addEventListener("abort", abort, { once: true })
      })
    } else this.active++
    try {
      signal?.throwIfAborted()
      return await fn()
    } finally {
      const next = this.waiters.shift()
      if (next) next()
      else this.active--
    }
  }
}

const spawning = new WorkQueue(1)
const semantic = new WorkQueue(2)
export function memoryWork<T>(kind: "spawn" | "semantic", fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted()
  return memoryProfile() === "low" ? (kind === "spawn" ? spawning : semantic).run(fn, signal) : fn()
}
