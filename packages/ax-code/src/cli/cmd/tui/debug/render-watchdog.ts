import { DiagnosticLog } from "@/debug/diagnostic-log"

// Repaint count per second; well above what a healthy TUI ever needs (60fps
// would already be excessive for terminal output, and opentui coalesces
// multiple requestRender() calls into a single frame — anything over this is
// a hot loop calling requestRender() many times per microtask).
const RENDER_LOOP_WINDOW_MS = 1_000
const RENDER_LOOP_THRESHOLD = 200
const RENDER_LOOP_THROTTLE_MS = 5_000

type RendererLike = {
  requestRender: () => void
}

type WatchdogState = {
  count: number
  windowStartedAt: number
  lastAlertAt: number
}

function createState(): WatchdogState {
  return { count: 0, windowStartedAt: Date.now(), lastAlertAt: 0 }
}

// Roll a 1s window. Returns true if the most recent observation crossed the
// threshold and we should fire (after throttle check).
function observe(state: WatchdogState, now: number): boolean {
  if (now - state.windowStartedAt >= RENDER_LOOP_WINDOW_MS) {
    state.count = 0
    state.windowStartedAt = now
  }
  state.count++
  if (state.count < RENDER_LOOP_THRESHOLD) return false
  if (now - state.lastAlertAt < RENDER_LOOP_THROTTLE_MS) return false
  state.lastAlertAt = now
  return true
}

// Wraps `renderer.requestRender` to count invocations. When opentui (or any
// caller above it) enters a loop that synchronously requests renders many
// times per microtask, this fires `tui.render.loopDetected`.
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
  RENDER_LOOP_WINDOW_MS,
  RENDER_LOOP_THRESHOLD,
  RENDER_LOOP_THROTTLE_MS,
}
