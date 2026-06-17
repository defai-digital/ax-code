type FlushableStream = {
  write: (chunk: string, callback?: () => void) => boolean
  writable?: boolean
  destroyed?: boolean
}

export const TUI_MOUSE_TRACKING_DISABLE_SEQUENCE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l"

// Cursor-home + erase-entire-display. In main-screen mode the renderer paints
// directly on the normal terminal buffer (no alternate screen to restore on
// exit), so the last TUI frame lingers after teardown and looks like a still
// running session. Emitting this on clean exit clears the stale frame. See #261.
export const TUI_MAIN_SCREEN_CLEAR_SEQUENCE = "\x1b[H\x1b[2J"

export function disableTuiMouseTracking(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return false
  stream.write(TUI_MOUSE_TRACKING_DISABLE_SEQUENCE)
  return true
}

export function clearTuiMainScreen(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return false
  stream.write(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
  return true
}

export function flushTuiStdout(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    try {
      stream.write("", done)
    } catch {
      done()
    }
  })
}
