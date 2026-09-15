import { createEffect, createSignal, onCleanup } from "solid-js"
import { shouldUseTuiAnimations } from "../../component/spinner-profile"
import { scheduleTuiInterval } from "@tui/util/timer"

// Breathing-pulse driver used to signal "an autonomous step is in flight"
// on the assistant text bubble, the transcript outer border, and the
// header chip. All three consumers share a single timer (refcount-gated)
// and a single phase signal so their highlights stay in sync — visually
// it should look like one breathing cue, not three independent blinkers.
//
// The phase walks a half-sine wave so the brightness eases in and out
// smoothly (a saw tooth feels twitchy in a terminal). Period and tick
// are picked to be perceptibly alive without dominating attention:
//   - PERIOD_MS = 1400  → roughly one human breath
//   - TICK_MS   = 100   → 10 Hz, matches Spinner interval
// Consumers that don't want / can't render animations (compiled binary
// build, or user disabled `animations_enabled` in kv) get a constant
// mid-phase so the static highlight still shows but does not pulse.
//
// Chrome (header chip, transcript border) and surface (assistant bubble
// wash) share this timer but use different alpha ranges: a background
// tint at chrome alphas would wash out the text.

const PERIOD_MS = 1400
const TICK_MS = 100
const STATIC_PHASE = 0.5

export const AUTONOMOUS_CHROME_PULSE_MIN_ALPHA = 0.55
export const AUTONOMOUS_CHROME_PULSE_MAX_ALPHA = 1.0
export const AUTONOMOUS_SURFACE_PULSE_MIN_ALPHA = 0.14
export const AUTONOMOUS_SURFACE_PULSE_MAX_ALPHA = 0.3

export function pulseAlpha(phase: number, min: number, max: number) {
  return min + (max - min) * phase
}

const [phase, setPhase] = createSignal(STATIC_PHASE)
let cancelTimer: (() => void) | undefined
let startTime = 0
let refCount = 0

function tick() {
  const elapsed = Date.now() - startTime
  const radians = (elapsed / PERIOD_MS) * Math.PI * 2
  // (sin + 1) / 2 maps -1..1 to 0..1.
  setPhase((Math.sin(radians) + 1) / 2)
}

function start() {
  refCount++
  if (refCount > 1) return
  startTime = Date.now()
  tick()
  cancelTimer = scheduleTuiInterval(tick, {
    name: "autonomous-pulse",
    delayMs: TICK_MS,
    unref: true,
  })
}

function stop() {
  refCount = Math.max(0, refCount - 1)
  if (refCount > 0) return
  cancelTimer?.()
  cancelTimer = undefined
  setPhase(STATIC_PHASE)
}

// SolidJS hook: subscribes to the shared pulse driver while `active()`
// is true, and returns a 0..1 phase accessor consumers can blend into
// any color or alpha. Cleans up on unmount or when `active()` flips back
// to false, so the timer dies as soon as no autonomous turn is running.
export function useAutonomousPulse(
  active: () => boolean,
  options: { animationsEnabled?: () => boolean } = {},
): () => number {
  const animationsEnabled = options.animationsEnabled ?? (() => true)

  createEffect(() => {
    if (!active()) return
    if (!shouldUseTuiAnimations({ userEnabled: animationsEnabled() })) return
    start()
    onCleanup(stop)
  })

  return phase
}
