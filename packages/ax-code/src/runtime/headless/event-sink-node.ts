import { createWriteStream, type WriteStream } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { createHeadlessJsonlEventSink, type HeadlessEventSink } from "./event-sink"

export async function createHeadlessJsonlFileEventSink(file: string): Promise<HeadlessEventSink> {
  await mkdir(path.dirname(file), { recursive: true })
  return createHeadlessFileJsonlEventSink(file)
}

export function createHeadlessFileJsonlEventSink(file: string): HeadlessEventSink {
  const stream = createWriteStream(file, { flags: "w" })
  let streamError: Error | undefined
  // Writable streams throw and crash the process if they emit "error" while
  // no listener is attached. writeLineToStream/endStream only listen for
  // "error" while a write or close is in flight, so an I/O failure between
  // calls (e.g. ENOSPC, permission revoked mid-run) would otherwise take
  // down the whole headless process instead of failing this sink. Keep a
  // permanent listener so such errors are captured and surfaced on the next
  // write/close instead of crashing.
  stream.on("error", (error) => {
    streamError = error
  })
  const sink = createHeadlessJsonlEventSink((line) => {
    if (streamError) throw streamError
    return writeLineToStream(stream, line)
  })
  return {
    write: sink.write,
    close: async () => {
      await endStream(stream)
      if (streamError) throw streamError
    },
  }
}

async function writeLineToStream(stream: WriteStream, line: string) {
  if (stream.write(line)) return

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", onDrain)
      stream.off("error", onError)
    }
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    stream.once("drain", onDrain)
    stream.once("error", onError)
  })
}

async function endStream(stream: WriteStream) {
  if (stream.destroyed) return

  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off("finish", onFinish)
      stream.off("error", onError)
    }
    const onFinish = () => {
      cleanup()
      resolve()
    }
    const onError = (error: Error) => {
      cleanup()
      reject(error)
    }
    stream.once("finish", onFinish)
    stream.once("error", onError)
    stream.end()
  })
}
