import { createEffect, createMemo } from "solid-js"
import { DiagnosticLog } from "@/debug/diagnostic-log"

// A single reactive node running this often per second in steady state is
// pathological — legitimate computed memos don't repeat 100+ times/s because
// their dependencies don't change that fast.
const LOOP_WINDOW_MS = 1_000
const LOOP_THRESHOLD = 100
// Wall-clock throttle on how often we emit the same label. Uses Date.now()
// (monotonic inside a sync loop) so it still works when the event loop never
// yields — same rationale as the store's burst throttle.
const LOOP_THROTTLE_MS = 5_000

type TracerState = {
  label: string
  window: number[]
  lastAlertAt: number
}

function createTracer(label: string): TracerState {
  return { label, window: [], lastAlertAt: 0 }
}

function observe(state: TracerState, now: number) {
  const cutoff = now - LOOP_WINDOW_MS
  let start = 0
  while (start < state.window.length && state.window[start]! < cutoff) start++
  if (start > 0) state.window.splice(0, start)
  state.window.push(now)
  if (state.window.length < LOOP_THRESHOLD) return false
  if (now - state.lastAlertAt < LOOP_THROTTLE_MS) return false
  state.lastAlertAt = now
  return true
}

function alert(state: TracerState, now: number) {
  DiagnosticLog.recordProcess("tui.effect.loopDetected", {
    label: state.label,
    runs: state.window.length,
    windowMs: LOOP_WINDOW_MS,
    firstObservedAt: new Date(state.window[0]!).toISOString(),
    lastObservedAt: new Date(now).toISOString(),
  })
}

// Wraps `createEffect(fn)` with a per-label exec-rate observer. When
// DiagnosticLog is off (the default on non-debug runs) this is literally just
// `createEffect(fn)` — no per-run cost, no extra allocations.
//
// Use this for effects that cross reactive store boundaries (writes derived
// from reads), or for any effect whose feedback risk is not obvious from
// reading the body. Don't blanket-wrap every effect: labels cost nothing but
// the whole point is to find loops that the human-readable label can name.
export function tracedEffect(label: string, fn: () => void) {
  if (!DiagnosticLog.enabled()) {
    createEffect(fn)
    return
  }
  const state = createTracer(label)
  createEffect(() => {
    if (observe(state, Date.now())) alert(state, Date.now())
    fn()
  })
}

export function tracedMemo<T>(label: string, fn: () => T) {
  if (!DiagnosticLog.enabled()) return createMemo(fn)
  const state = createTracer(label)
  return createMemo(() => {
    if (observe(state, Date.now())) alert(state, Date.now())
    return fn()
  })
}

// Exported for tests — lets them simulate tight-loop conditions with a fake
// clock without needing to actually drive Solid's reactive system.
export const __internals = {
  createTracer,
  observe,
  LOOP_WINDOW_MS,
  LOOP_THRESHOLD,
  LOOP_THROTTLE_MS,
}
