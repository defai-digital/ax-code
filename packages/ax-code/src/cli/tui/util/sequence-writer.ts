// Out-of-band terminal sequences (OSC title/progress, notifications, OSC52
// clipboard, modifyOtherKeys) written straight to stdout race the native
// render thread when the advanced profile renders with useThread: a JS-side
// write can splice into a frame mid-CSI/SGR, the terminal aborts that
// sequence, and the frame tail paints as literal text mid-screen. Routing
// through the renderer's native write queue (which waits on the render
// thread) serializes the two write sources. The compatible profile renders
// single-threaded, so it keeps the direct stream write — the native path is
// gated on `threaded`, mirroring the renderer's own writeOut condition.

export type TuiSequenceTarget = {
  /** True only while the mounted renderer draws from a native thread. */
  threaded: boolean
  write: (sequence: string) => void
}

let active: TuiSequenceTarget | undefined

export function registerTuiSequenceTarget(target: TuiSequenceTarget) {
  active = target
}

export function unregisterTuiSequenceTarget(target: TuiSequenceTarget) {
  if (active === target) active = undefined
}

/**
 * Routes one complete sequence through the active renderer's native write
 * queue. Returns false when no threaded renderer is mounted or the native
 * write fails, so the caller can fall back to a direct stream write.
 */
export function writeTuiSequenceThroughRenderer(sequence: string): boolean {
  const target = active
  if (!target || !target.threaded) return false
  try {
    target.write(sequence)
    return true
  } catch {
    return false
  }
}
