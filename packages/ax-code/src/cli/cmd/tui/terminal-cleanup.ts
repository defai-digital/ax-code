type FlushableStream = {
  write: (chunk: string, callback?: () => void) => boolean
  writable?: boolean
  destroyed?: boolean
}

type RawModeStream = {
  isTTY?: boolean
  setRawMode?: (mode: boolean) => unknown
}

export const TUI_MOUSE_TRACKING_DISABLE_SEQUENCE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l"
export const TUI_TERMINAL_CRASH_RESET_SEQUENCE = `${TUI_MOUSE_TRACKING_DISABLE_SEQUENCE}\x1b[?2004l\x1b[?25h\x1b[?1049l`

// Cursor-home + erase-entire-display. In main-screen mode the renderer paints
// directly on the normal terminal buffer (no alternate screen to restore on
// exit), so the last TUI frame lingers after teardown and looks like a still
// running session. Emitting this on clean exit clears the stale frame. See #261.
export const TUI_MAIN_SCREEN_CLEAR_SEQUENCE = "\x1b[H\x1b[2J"

export function disableTuiMouseTracking(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(TUI_MOUSE_TRACKING_DISABLE_SEQUENCE)
    return true
  } catch {
    return false
  }
}

export function clearTuiMainScreen(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return false
  try {
    stream.write(TUI_MAIN_SCREEN_CLEAR_SEQUENCE)
    return true
  } catch {
    return false
  }
}

export function restoreTuiStdinMode(stream: RawModeStream = process.stdin) {
  if (!stream.isTTY || typeof stream.setRawMode !== "function") return false
  try {
    stream.setRawMode(false)
    return true
  } catch {
    return false
  }
}

export function resetTuiTerminalState(input: { stdout?: FlushableStream; stdin?: RawModeStream } = {}) {
  const stdinRestored = restoreTuiStdinMode(input.stdin)
  const stdout = input.stdout ?? process.stdout
  if (stdout.writable === false || stdout.destroyed) return stdinRestored
  try {
    stdout.write(TUI_TERMINAL_CRASH_RESET_SEQUENCE)
    return true
  } catch {
    return stdinRestored
  }
}

// Cap how long teardown waits for the final stdout write. If the stream is in
// a degraded state (broken pipe that hasn't surfaced as `destroyed` yet) the
// write callback never fires and the exit promise would otherwise hang forever,
// leaving the terminal stuck in raw/alt-screen mode.
const FLUSH_TIMEOUT_MS = 500

export function flushTuiStdout(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return Promise.resolve()
  return new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      resolve()
    }
    // Safety net: resolve even if the write callback is lost.
    const timer = setTimeout(done, FLUSH_TIMEOUT_MS)
    timer.unref?.()
    try {
      stream.write("", done)
    } catch {
      done()
    }
  })
}
