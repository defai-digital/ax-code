import { createEffect, createSignal, onCleanup } from "solid-js"
import { scheduleTuiTimeout } from "../../util/timer"

// Base paint interval while streaming (~25 Hz). Store deltas can arrive much
// faster; repainting every delta would dominate the TUI main-thread cost.
export const STREAM_PAINT_MS = 40
// Upper bound for long documents. Streaming paints are plain text (the rich
// markdown/code renderer mounts once at finalize), so a paint is a cheap
// wrap + buffer write — a high cap would only make long streams look frozen
// without saving meaningful work.
export const STREAM_PAINT_MAX_MS = 120
// Document length step (chars) that adds STREAM_PAINT_STEP_MS to the interval.
export const STREAM_PAINT_LENGTH_STEP = 2000
export const STREAM_PAINT_STEP_MS = 20

// Scaling the interval with document length keeps total streaming work
// near-linear while short responses stay snappy.
export function streamPaintIntervalMs(length: number) {
  return Math.min(
    STREAM_PAINT_MAX_MS,
    STREAM_PAINT_MS + Math.floor(length / STREAM_PAINT_LENGTH_STEP) * STREAM_PAINT_STEP_MS,
  )
}

export type StreamPaintDecision =
  | { action: "paint-now" }
  | { action: "schedule"; delayMs: number }

// Pure timing decision for one streaming update, kept separate from the Solid
// hook so it stays unit-testable without a renderer.
export function streamPaintDecision(input: { final: boolean; now: number; lastPaintAt: number; length: number }): StreamPaintDecision {
  if (input.final) return { action: "paint-now" }
  const remaining = Math.max(0, streamPaintIntervalMs(input.length) - (input.now - input.lastPaintAt))
  if (remaining === 0) return { action: "paint-now" }
  return { action: "schedule", delayMs: remaining }
}

// Throttled view of a streaming text source: updates immediately once the
// source is final, otherwise at most once per streamPaintIntervalMs(length).
// Used by text and reasoning parts so streaming repaints stay bounded.
export function createStreamPaintThrottle(input: { text: () => string; final: () => boolean }) {
  const [paintedText, setPaintedText] = createSignal(input.text())
  let paintCancel: (() => void) | undefined
  let lastPaintAt = 0
  createEffect(() => {
    const next = input.text()
    const decision = streamPaintDecision({
      final: input.final(),
      now: Date.now(),
      lastPaintAt,
      length: next.length,
    })
    paintCancel?.()
    paintCancel = undefined
    if (decision.action === "paint-now") {
      lastPaintAt = Date.now()
      setPaintedText(next)
      return
    }
    paintCancel = scheduleTuiTimeout(
      () => {
        paintCancel = undefined
        lastPaintAt = Date.now()
        setPaintedText(input.text())
      },
      { name: "session.stream-paint", delayMs: decision.delayMs, unref: true },
    )
  })
  onCleanup(() => {
    paintCancel?.()
  })
  return paintedText
}
