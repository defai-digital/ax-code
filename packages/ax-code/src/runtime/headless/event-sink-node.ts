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
  const sink = createHeadlessJsonlEventSink((line) => writeLineToStream(stream, line))
  return {
    write: sink.write,
    close: () => endStream(stream),
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
