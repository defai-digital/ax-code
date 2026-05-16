type FlushableStream = {
  write: (chunk: string, callback?: () => void) => boolean
  writable?: boolean
  destroyed?: boolean
}

export const TUI_MOUSE_TRACKING_DISABLE_SEQUENCE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?1015l"

export function disableTuiMouseTracking(stream: FlushableStream = process.stdout) {
  if (stream.writable === false || stream.destroyed) return false
  stream.write(TUI_MOUSE_TRACKING_DISABLE_SEQUENCE)
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
