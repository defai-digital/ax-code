import { DiagnosticLog } from "@/debug/diagnostic-log"

// Repaint count per second; well above what a healthy TUI ever needs (60fps
// would already be excessive for terminal output, and opentui coalesces
// multiple requestRender() calls into a single frame — anything over this is
// a hot loop calling requestRender() many times per microtask).
const RENDER_LOOP_WINDOW_MS = 1_000
const RENDER_LOOP_THRESHOLD = 200

type RendererLike = {
  requestRender: () => void
}

type WatchdogState = {
  count: number
  windowStartedAt: number
  alertedThisWindow: boolean
}

function createState(): WatchdogState {
  return { count: 0, windowStartedAt: Date.now(), alertedThisWindow: false }
}

// Roll a 1s window. Returns true at most once per window (when threshold is
// crossed). The window itself is the rate limiter — no wall-clock throttle.
//
// Removing the throttle was deliberate: in v2.24.5 the startup paint legitimately
// burned the throttle, so the actual hang's render burst (a few seconds later)
// was suppressed and we lost the freeze-time stack. With one alert per window
// we get one record per second of sustained looping — the freeze chain is
// captured even when startup also bursts.
function observe(state: WatchdogState, now: number): boolean {
  if (now - state.windowStartedAt >= RENDER_LOOP_WINDOW_MS) {
    state.count = 0
    state.windowStartedAt = now
    state.alertedThisWindow = false
  }
  state.count++
  if (state.count < RENDER_LOOP_THRESHOLD) return false
  if (state.alertedThisWindow) return false
  state.alertedThisWindow = true
  return true
}

// Captures the stack of the *current* requestRender call so we can name the
// caller chain that's spinning. Invoked when the watchdog fires — at most once
// per RENDER_LOOP_WINDOW_MS, so worst case ~1 stack walk per second during a
// sustained loop. We strip our own wrapper frames so the first reported frame
// is the real caller.
function captureCallerStack(maxFrames = 20): string[] {
  const raw = new Error().stack
  if (!raw) return []
  const lines = raw.split("\n")
  const out: string[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("at ")) continue
    if (trimmed.includes("render-watchdog")) continue
    if (trimmed.includes("captureCallerStack")) continue
    out.push(trimmed)
    if (out.length >= maxFrames) break
  }
  return out
}

// Wraps `renderer.requestRender` to count invocations. When opentui (or any
// caller above it) enters a loop that synchronously requests renders many
// times per microtask, this fires `tui.render.loopDetected` *with a stack
// trace* of one of the offending calls — that's the cheapest way to point
// at the component or library frame driving the loop.
//
// Catches the case where the hang is *outside* the SolidJS reactive system
// — the store + tracedEffect signals only cover loops that flow through Solid
// signals or the TUI store reducer. opentui's own paint/event pipeline can
// loop independently.
//
// Returns a dispose function that restores the original method.
export function installRenderWatchdog(renderer: RendererLike): () => void {
  if (!DiagnosticLog.enabled()) return () => {}
  if (!renderer || typeof renderer.requestRender !== "function") return () => {}

  const original = renderer.requestRender.bind(renderer)
  const state = createState()

  renderer.requestRender = function () {
    if (observe(state, Date.now())) {
      DiagnosticLog.recordProcess("tui.render.loopDetected", {
        windowMs: RENDER_LOOP_WINDOW_MS,
        renders: state.count,
        windowStartedAt: new Date(state.windowStartedAt).toISOString(),
        // Only walked when the watchdog actually fires, so this runs at most
        // once per RENDER_LOOP_THROTTLE_MS — practically free even when the
        // main thread is otherwise hot.
        stack: captureCallerStack(),
      })
    }
    original()
  }

  return () => {
    renderer.requestRender = original
  }
}

export const __internals = {
  createState,
  observe,
  captureCallerStack,
  RENDER_LOOP_WINDOW_MS,
  RENDER_LOOP_THRESHOLD,
}
