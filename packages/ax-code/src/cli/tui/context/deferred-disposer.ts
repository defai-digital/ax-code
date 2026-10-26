import { Log } from "@/util/log"
import { scheduleUnref } from "@/util/timeout"

const log = Log.create({ service: "tui.deferred-disposer" })

// Defers destroying a superseded native-backed instance. Renderables swap to
// the new instance synchronously when their reactive prop updates, before the
// effect that calls track() runs; the delay covers work already in flight
// (an async highlight finishing) that may still read the previous one. A
// destroyed SyntaxStyle throws on use instead of touching freed memory.
export type DeferredDisposable = { destroy: () => void }

const DISPOSE_DELAY_MS = 1_000

function scheduleDispose(fn: () => void) {
  return scheduleUnref(fn, DISPOSE_DELAY_MS)
}

export function createDeferredDisposer(schedule: (fn: () => void) => void | { clear: () => void } = scheduleDispose) {
  let current: DeferredDisposable | undefined
  const pending = new Map<DeferredDisposable, { clear?: () => void }>()
  const destroyed = new WeakSet<DeferredDisposable>()

  function destroyOnce(instance: DeferredDisposable) {
    if (destroyed.has(instance)) return
    // Mark before destroying so a re-entrant destroy() cannot recurse.
    destroyed.add(instance)
    instance.destroy()
  }

  return {
    track(next: DeferredDisposable) {
      if (next === current) return
      const previous = current
      current = next
      pending.get(next)?.clear?.()
      pending.delete(next)
      if (!previous) return
      const generation: { clear?: () => void } = {}
      pending.set(previous, generation)
      const handle = schedule(() => {
        if (pending.get(previous) !== generation) return
        pending.delete(previous)
        // The instance may have become current again since it was scheduled.
        if (previous === current) return
        try {
          destroyOnce(previous)
        } catch (error) {
          // destroy() runs from a timer; a throw here is an uncaught exception that can crash the TUI.
          log.warn("failed to destroy superseded instance", { error })
        }
      })
      if (handle) generation.clear = () => handle.clear()
    },
    dispose() {
      const instances = new Map(pending)
      if (current) instances.set(current, {})
      pending.clear()
      current = undefined
      let failure: { error: unknown } | undefined
      for (const [instance, scheduled] of instances) {
        try {
          scheduled.clear?.()
        } catch (error) {
          failure ??= { error }
        }
        try {
          destroyOnce(instance)
        } catch (error) {
          failure ??= { error }
        }
      }
      if (failure) throw failure.error
    },
  }
}
