import { fstatSync } from "node:fs"

export const DEFAULT_STDIN_PIPE_QUIET_WINDOW_MS = 300

type StdinLike = {
  on(event: "data", listener: (chunk: Buffer | string) => void): unknown
  on(event: "end", listener: () => void): unknown
  on(event: "error", listener: (error: Error) => void): unknown
  off(event: string, listener: (...args: any[]) => void): unknown
  pause?: () => unknown
}

function stdinIsRegularFile(fd = 0): boolean {
  try {
    return fstatSync(fd).isFile()
  } catch {
    // fstat can fail for exotic descriptors. Treat them like pipes so an
    // open descriptor cannot hold a headless command at startup forever.
    return false
  }
}

/**
 * Read non-TTY stdin without waiting forever for an open pipe. Regular files
 * have a reliable EOF and are read completely. Pipes and FIFOs resolve after
 * a short quiet window, which lets background-launched AX Code processes
 * start even though their parent keeps stdin open for later bash_input calls.
 */
export function readNonTtyStdin(
  input: {
    stdin?: StdinLike
    isRegularFile?: boolean
    quietWindowMs?: number
    /** Explicit stdin input waits for EOF even on a slow pipe. */
    waitForEof?: boolean
    signal?: AbortSignal
  } = {},
): Promise<string> {
  const stdin = input.stdin ?? (process.stdin as unknown as StdinLike)
  const isRegularFile = input.isRegularFile ?? stdinIsRegularFile()
  const quietWindowMs = input.quietWindowMs ?? DEFAULT_STDIN_PIPE_QUIET_WINDOW_MS
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false
    let quietTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      if (quietTimer) clearTimeout(quietTimer)
      stdin.off("data", onData)
      stdin.off("end", onEnd)
      stdin.off("error", onError)
      input.signal?.removeEventListener("abort", onAbort)
    }
    const finish = (pause: boolean) => {
      if (settled) return
      settled = true
      cleanup()
      if (pause) stdin.pause?.()
      resolve(Buffer.concat(chunks).toString("utf8"))
    }
    const armQuietTimer = () => {
      if (isRegularFile || input.waitForEof) return
      if (quietTimer) clearTimeout(quietTimer)
      quietTimer = setTimeout(() => finish(true), quietWindowMs)
      quietTimer.unref?.()
    }
    const onData = (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      armQuietTimer()
    }
    const onEnd = () => finish(false)
    const onError = (error: Error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    }
    const onAbort = () => {
      onError(input.signal?.reason ?? new Error("Stdin read cancelled"))
      stdin.pause?.()
    }
    if (input.signal?.aborted) {
      onAbort()
      return
    }
    input.signal?.addEventListener("abort", onAbort, { once: true })
    stdin.on("data", onData)
    stdin.on("end", onEnd)
    stdin.on("error", onError)
    // An idle open pipe emits neither data nor end, so start the quiet window
    // before the first chunk. Regular files remain EOF-driven.
    armQuietTimer()
  })
}
