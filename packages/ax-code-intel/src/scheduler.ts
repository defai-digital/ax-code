import { Log } from "./internal/log"
import { codeIntelHostMaybe } from "./host"

// Scheduler primitives for the LSP semantic layer (Semantic Trust v2 §S1+S2).
//
// Two responsibilities, kept as sibling namespaces so call sites can opt into
// either independently:
//
//   LspScheduler.Inflight — deduplicate concurrent identical semantic queries
//   LspScheduler.Budget   — per-server concurrency cap with blocking acquire
//
// Both are pure in-memory state; no SQLite, no cross-process coordination.
// A future multi-process split would replace each with an IPC-backed variant,
// but the call-site contract stays the same.

const log = Log.create({ service: "lsp.scheduler" })

export namespace LspScheduler {
  // ─── Inflight dedup ────────────────────────────────────────────────
  //
  // Registry of in-flight promises keyed by semantic query identity.
  // When `run(key, fn)` is called and the key is already in flight, the
  // caller receives the existing promise — the factory `fn` is NOT
  // invoked a second time. This collapses duplicate AI tool calls that
  // happen to ask for the same thing in the same turn (e.g. `references`
  // + `hover` on the same position trigger two workflows but only one
  // underlying RPC).
  //
  // Eviction is eager and settle-driven: the registry entry is removed
  // inside a `.finally` on the wrapped promise, before the result is
  // delivered to followers. Followers get the same resolved value or
  // the same rejection.
  //
  // Key shape is caller-defined. For envelope-returning LSP ops the
  // convention is `${operation}:${file}:${contentHash}:${line}:${character}`.
  // Content hash in the key means an intervening file edit produces a
  // different key and does not collapse into the stale in-flight call.
  export namespace Inflight {
    const registry = new Map<string, Promise<unknown>>()

    export function run<T>(key: string, fn: () => Promise<T>): Promise<T> {
      const existing = registry.get(key) as Promise<T> | undefined
      if (existing) return existing

      // Defensive against sync throws inside `fn`. Even though the
      // signature is `() => Promise<T>` and all current call sites
      // are async functions (which can't throw sync), a future
      // non-async caller could accidentally throw before the first
      // await — that would skip `registry.set` below and leave us
      // with no dedup AND a rejected promise propagating to the
      // caller. Normalizing to a rejected promise makes the
      // registry contract stable regardless of how fn signals failure.
      let inflight: Promise<T>
      try {
        inflight = fn()
      } catch (err) {
        inflight = Promise.reject(err)
      }

      const promise = inflight.finally(() => {
        // Only evict if we're still the registered entry. A second
        // `run(key, ...)` after ours settles is allowed to register its
        // own promise — don't unregister theirs.
        if (registry.get(key) === promise) registry.delete(key)
      }) as Promise<T>

      registry.set(key, promise as Promise<unknown>)
      return promise
    }

    // Exported for tests and diagnostics. Do not rely on this in hot-
    // path logic — the right primitive for "is this cached" is the
    // cache layer, not the in-flight registry.
    export function size(): number {
      return registry.size
    }

    export function resetForTest(): void {
      registry.clear()
    }
  }

  // ─── Per-server budget ─────────────────────────────────────────────
  //
  // Bounded concurrency per LSP server. Issued via `acquire(serverID)`
  // which returns a release function; callers must invoke it on settle
  // (use try/finally). If the server is at its cap, `acquire` blocks
  // on a queued promise that resolves when a slot frees up.
  //
  // 30s hard cap on a single acquire. Timing out converts to a queued
  // rejection so callers can treat it like any other LSP-side failure
  // (one `failures++` in runWithEnvelope) rather than leaking an
  // unresolved promise. On a healthy system this timeout should never
  // fire; when it does, it's evidence of a real pileup that needs
  // diagnosis, not silent delay.
  //
  // Default budget (4) matches tsserver's internal request batch size
  // and is a reasonable floor for mainstream servers. Per-server
  // overrides will be read from Config once the schema grows a
  // `lsp.<id>.concurrency` field; for now every server uses the
  // default.
  export namespace Budget {
    const DEFAULT_BUDGET = 4
    const ACQUIRE_TIMEOUT_MS = 30_000

    type Waiter = {
      resolve: (release: () => void) => void
      reject: (err: Error) => void
      timer: ReturnType<typeof setTimeout>
      // Marks the waiter as already woken up (resolved or rejected).
      // Used to resolve the race between a slot free-up shift() and a
      // timeout firing on the same waiter. See Bug #2 fix below.
      settled: boolean
    }

    type Slot = {
      budget: number
      inUse: number
      waiters: Waiter[]
    }

    const slots = new Map<string, Slot>()
    const overrides = new Map<string, number>()

    // The cap follows the project, not the server name alone: one process can
    // serve several projects (the core wires the host's projectRoot to the
    // ambient Instance), and two of them configuring the same server id would
    // otherwise share one in-flight counter and overwrite each other's budget.
    // The scoped key is captured by `acquire` and passed to its release, so a
    // release never resolves against another project's slot.
    function scopedKey(serverID: string): string {
      const root = codeIntelHostMaybe()?.projectRoot?.()
      return root ? `${root}\u0000${serverID}` : serverID
    }

    function getSlot(key: string): Slot {
      let slot = slots.get(key)
      if (!slot) {
        slot = {
          budget: overrides.get(key) ?? DEFAULT_BUDGET,
          inUse: 0,
          waiters: [],
        }
        slots.set(key, slot)
      }
      return slot
    }

    function makeRelease(key: string): () => void {
      let released = false
      return () => {
        if (released) return
        released = true
        const slot = slots.get(key)
        if (!slot) return
        slot.inUse--
        // Wake one waiter FIFO. Skip waiters that already settled via
        // a timeout that fired in the same tick — otherwise we'd
        // increment inUse for a slot that nobody actually owns
        // (because the "winner" already got rejected), eventually
        // looking like "budget full but nothing using it".
        while (slot.waiters.length > 0) {
          const next = slot.waiters.shift()!
          if (next.settled) continue
          next.settled = true
          clearTimeout(next.timer)
          slot.inUse++
          next.resolve(makeRelease(key))
          return
        }
      }
    }

    // Acquire a budget slot for the given server. Returns a release
    // function; caller MUST invoke it (typically in a try/finally).
    // If the server is at cap, blocks until a slot frees or 30s
    // elapses (rejects with Error on timeout).
    export function acquire(serverID: string): Promise<() => void> {
      const key = scopedKey(serverID)
      const slot = getSlot(key)
      if (slot.inUse < slot.budget) {
        slot.inUse++
        return Promise.resolve(makeRelease(key))
      }
      return new Promise((resolve, reject) => {
        const waiter = { resolve, reject, timer: null as any, settled: false }
        const timer = setTimeout(() => {
          if (waiter.settled) return
          waiter.settled = true
          // Remove ourselves from the waiter queue so we don't get
          // woken up into a leaked slot after timing out.
          const idx = slot.waiters.indexOf(waiter)
          if (idx >= 0) slot.waiters.splice(idx, 1)
          log.warn("budget.acquire timed out", { serverID, budget: slot.budget })
          reject(new Error(`lsp scheduler: budget acquire timed out on ${serverID}`))
        }, ACQUIRE_TIMEOUT_MS)
        // Don't keep the event loop alive just because a waiter is
        // queued. Short-lived CLI processes (e.g. `ax-code debug
        // replay`) would otherwise hang 30s on exit if a budget
        // slot never freed up.
        if (typeof timer.unref === "function") timer.unref()
        waiter.timer = timer
        slot.waiters.push(waiter)
      })
    }

    // Override the per-server budget. Safe to call from production
    // code (e.g. once Config grows a `lsp.<id>.concurrency` field).
    // A zero or negative budget is coerced to 1 to avoid deadlocking
    // the server. Increasing the budget does NOT retroactively wake
    // queued waiters — only new acquires see the new cap; document
    // this limit at call sites that might reconfigure mid-run.
    export function setBudget(serverID: string, budget?: number): void {
      const key = scopedKey(serverID)
      if (budget === undefined) {
        overrides.delete(key)
        const slot = slots.get(key)
        if (slot) slot.budget = DEFAULT_BUDGET
        return
      }

      overrides.set(key, Math.max(1, budget))
      const slot = slots.get(key)
      if (slot) slot.budget = Math.max(1, budget)
    }

    // Exported for tests and diagnostics.
    export function inUse(serverID: string): number {
      return slots.get(scopedKey(serverID))?.inUse ?? 0
    }

    export function resetForTest(): void {
      for (const slot of slots.values()) {
        for (const w of slot.waiters) {
          clearTimeout(w.timer)
          w.reject(new Error("budget reset"))
        }
      }
      slots.clear()
      overrides.clear()
    }
  }
}
