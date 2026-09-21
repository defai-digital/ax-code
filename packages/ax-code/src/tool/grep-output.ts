import { Process } from "../util/process"

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024

/** Own and drain the fallback search process while bounding retained output. */
export async function readGrepOutput(proc: Process.Child, abort: AbortSignal, onLine: (line: string) => void) {
  // Frame raw bytes before decoding: a UTF-8 code point can cross chunks, but
  // cannot contain the LF delimiter. Only the unfinished record stays resident.
  let fragments: Buffer[] = []
  let fragmentBytes = 0
  let bytes = 0
  let capped = false
  let errorOutput = ""
  try {
    if (!proc.stdout || !proc.stderr) throw new Error("Process output not available")
    proc.stderr.on("data", (chunk: Buffer) => {
      errorOutput = (errorOutput + chunk.toString("utf8")).slice(0, 2000)
    })
    const stdout = proc.stdout
    // Event-based draining tolerates Process closing inherited descriptors
    // after child exit; stream consumers would report premature close there.
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        stdout.off("data", data)
        stdout.off("end", finish)
        stdout.off("close", finish)
        stdout.off("error", fail)
      }
      const finish = () => {
        cleanup()
        resolve()
      }
      const fail = (error: Error) => {
        cleanup()
        reject(error)
      }
      const data = (chunk: Buffer) => {
        try {
          abort.throwIfAborted()
          const remaining = MAX_CAPTURE_BYTES - bytes
          if (chunk.length > remaining) capped = true
          const accepted = chunk.subarray(0, remaining)
          bytes += accepted.length
          let start = 0
          for (let end = accepted.indexOf(10); end !== -1; end = accepted.indexOf(10, start)) {
            const tail = accepted.subarray(start, end)
            const record = fragments.length ? Buffer.concat([...fragments, tail], fragmentBytes + tail.length) : tail
            fragments = []
            fragmentBytes = 0
            onLine(record.toString("utf8"))
            start = end + 1
          }
          if (start < accepted.length) {
            fragments.push(accepted.subarray(start))
            fragmentBytes += accepted.length - start
          }
          if (capped) {
            stdout.pause()
            finish()
          }
        } catch (error) {
          stdout.pause()
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      }
      stdout.on("data", data)
      stdout.once("end", finish)
      stdout.once("close", finish)
      stdout.once("error", fail)
    })
    if (capped) await Process.stop(proc)
    const exitCode = await proc.exited
    abort.throwIfAborted()
    return { bytes, incompleteRecord: fragmentBytes > 0, errorOutput, exitCode, capped }
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) await Process.stop(proc)
    await proc.exited
  }
}
