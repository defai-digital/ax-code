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

// Best-effort callsite extractor. Walks the stack past our own frames and
// returns the first user frame as `file:line:col`. Empty string on parse
// failure — the caller falls back to "unknown".
//
// Resolved exactly once per createTracer (so per createEffect creation), not
// per execution, so the cost is paid at component-mount time and never again.
function callsiteLabel(): string {
  const stack = new Error().stack
  if (!stack) return ""
  const lines = stack.split("\n")
  for (const raw of lines) {
    const line = raw.trim()
    if (!line.startsWith("at ")) continue
    if (line.includes("effect-tracer")) continue
    if (line.includes("at Object.<anonymous>")) continue
    // Match either `at name (path:line:col)` or `at path:line:col`.
    const parens = line.match(/\(([^()]+:\d+:\d+)\)/)
    if (parens) return parens[1]!
    const bare = line.match(/at\s+([^\s()]+:\d+:\d+)$/)
    if (bare) return bare[1]!
  }
  return ""
}

function resolveLabel(input: string | (() => unknown), fallback: string): string {
  if (typeof input === "string") return input
  const auto = callsiteLabel()
  return auto ? auto : fallback
}

// Wraps `createEffect(fn)` with a per-label exec-rate observer. When
// DiagnosticLog is off (the default on non-debug runs) this is literally just
// `createEffect(fn)` — no per-run cost, no extra allocations, no stack walk.
//
// Two call shapes:
//   tracedEffect("module.purpose", () => { ... })  // explicit label
//   tracedEffect(() => { ... })                    // auto-label = file:line:col
//
// Use this for effects that cross reactive store boundaries (writes derived
// from reads), or for any effect whose feedback risk is not obvious from
// reading the body. Auto-label is fine for bulk wrapping; pick an explicit
// label when the call site doesn't read clearly out of the stack.
// EffectBody intentionally widened so callers can pass solid-js's
// `on(deps, handler)` return value (which has signature
// `(prev?: T) => T`). At runtime tracedEffect always calls fn() with no
// arguments — solid-js itself will pass the previous value when invoking the
// inner createEffect.
type EffectBody = (prev?: any) => any

export function tracedEffect(label: string, fn: EffectBody): void
export function tracedEffect(fn: EffectBody): void
export function tracedEffect(labelOrFn: string | EffectBody, maybeFn?: EffectBody): void {
  const fn = (maybeFn ?? labelOrFn) as EffectBody
  if (!DiagnosticLog.enabled()) {
    createEffect(fn)
    return
  }
  const state = createTracer(resolveLabel(labelOrFn, "tracedEffect"))
  createEffect((prev) => {
    if (observe(state, Date.now())) alert(state, Date.now())
    return fn(prev)
  })
}

export function tracedMemo<T>(label: string, fn: () => T): () => T
export function tracedMemo<T>(fn: () => T): () => T
export function tracedMemo<T>(labelOrFn: string | (() => T), maybeFn?: () => T): () => T {
  const fn = (maybeFn ?? labelOrFn) as () => T
  if (!DiagnosticLog.enabled()) return createMemo(fn)
  const state = createTracer(resolveLabel(labelOrFn, "tracedMemo"))
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
