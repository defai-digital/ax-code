import { Process } from "../util/process"

const MAX_CAPTURE_BYTES = 16 * 1024 * 1024

/** Own and drain the fallback search process while bounding retained output. */
export async function readGrepOutput(proc: Process.Child, abort: AbortSignal) {
  const chunks: Buffer[] = []
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
        const remaining = MAX_CAPTURE_BYTES - bytes
        if (chunk.length > remaining) capped = true
        const accepted = chunk.subarray(0, remaining)
        chunks.push(accepted)
        bytes += accepted.length
        if (capped) {
          stdout.pause()
          finish()
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
    return { output: Buffer.concat(chunks, bytes).toString("utf8"), errorOutput, exitCode, capped }
  } finally {
    if (proc.exitCode === null && proc.signalCode === null) await Process.stop(proc)
    await proc.exited
  }
}
