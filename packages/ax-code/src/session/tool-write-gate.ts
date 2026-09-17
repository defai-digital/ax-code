import { Instance } from "@/project/instance"
import type { SessionID } from "./schema"

/**
 * Session-scoped reader/writer gate for tool calls the model emits in
 * parallel inside one assistant message.
 *
 * The AI SDK executes every tool call of a step as soon as it arrives, so two
 * `edit` calls to one file, or an `edit` racing a `bash` test run, could
 * interleave. Batch already serializes its own children through
 * `concurrencySafe`; direct calls had no barrier at all. This gate gives
 * every direct call a lane: read-only tools take a shared lane and still run
 * in parallel with each other, mutating tools (file edits, shell, MCP) take
 * the exclusive lane and run alone, in arrival order. A waiting call that is
 * aborted leaves the queue immediately.
 *
 * Scope is one session: child sessions have their own gate, and Batch keeps
 * its own ordering barrier for the calls it dispatches.
 */
export namespace ToolWriteGate {
  export type Mode = "shared" | "exclusive"

  type Waiter = { mode: Mode; resolve: () => void; reject: (error: unknown) => void }
  type Lane = { active: Mode | undefined; count: number; queue: Waiter[] }

  const state = Instance.state(() => new Map<SessionID, Lane>())

  function lane(sessionID: SessionID) {
    const lanes = state()
    let current = lanes.get(sessionID)
    if (!current) {
      current = { active: undefined, count: 0, queue: [] }
      lanes.set(sessionID, current)
    }
    return current
  }

  function grantable(current: Lane, mode: Mode) {
    if (current.count === 0) return true
    return mode === "shared" && current.active === "shared"
  }

  function drain(sessionID: SessionID, current: Lane) {
    while (current.queue.length > 0) {
      const head = current.queue[0]!
      if (!grantable(current, head.mode)) return
      current.queue.shift()
      current.active = head.mode
      current.count += 1
      head.resolve()
    }
    // Every entry `lane()` adds via `lanes.set()` is removed here once the
    // session's gate goes fully idle (no holder, no waiters) — the map never
    // outlives concurrently active sessions.
    if (current.count === 0 && current.queue.length === 0) {
      const lanes = state()
      lanes.delete(sessionID)
    }
  }

  function release(sessionID: SessionID, current: Lane) {
    current.count = Math.max(0, current.count - 1)
    if (current.count === 0) current.active = undefined
    drain(sessionID, current)
  }

  /** Snapshot for tests and diagnostics. */
  export function inspect(sessionID: SessionID) {
    const current = state().get(sessionID)
    return current
      ? { active: current.active, count: current.count, waiting: current.queue.map((item) => item.mode) }
      : { active: undefined, count: 0, waiting: [] as Mode[] }
  }

  /**
   * Wait for a lane and return the release function. Strict FIFO: a shared
   * request queued behind an exclusive one waits for it, so a writer can
   * never be starved by a stream of readers.
   */
  export async function acquire(sessionID: SessionID, mode: Mode, abort?: AbortSignal): Promise<() => void> {
    const current = lane(sessionID)
    let released = false
    const releaseOnce = () => {
      if (released) return
      released = true
      release(sessionID, current)
    }
    if (current.queue.length === 0 && grantable(current, mode)) {
      current.active = mode
      current.count += 1
      return releaseOnce
    }
    if (abort?.aborted) throw abortError(abort)
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const waiter: Waiter = { mode, resolve, reject }
      const onAbort = () => {
        if (settled) return
        const index = current.queue.indexOf(waiter)
        // Already granted: the caller owns releaseOnce. Aborting the tool is
        // their job; rejecting here would leak the lane.
        if (index < 0) return
        settled = true
        current.queue.splice(index, 1)
        drain(sessionID, current)
        reject(abortError(abort!))
      }
      waiter.resolve = () => {
        if (settled) return
        settled = true
        abort?.removeEventListener("abort", onAbort)
        resolve()
      }
      abort?.addEventListener("abort", onAbort, { once: true })
      current.queue.push(waiter)
      drain(sessionID, current)
    })
    return releaseOnce
  }

  function abortError(signal: AbortSignal) {
    if (signal.reason instanceof Error) return signal.reason
    return new DOMException("Aborted", "AbortError")
  }
}
