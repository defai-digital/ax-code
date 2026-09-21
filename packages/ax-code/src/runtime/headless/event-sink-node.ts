import { constants, createWriteStream, openSync, type WriteStream } from "node:fs"
import { lstat, mkdir, realpath } from "node:fs/promises"
import path from "node:path"
import { Filesystem } from "../../util/filesystem"
import { createHeadlessJsonlEventSink, type HeadlessEventSink } from "./event-sink"

async function canonicalLogPath(file: string): Promise<string> {
  try {
    return await realpath(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    const stat = await lstat(file).catch((failure: NodeJS.ErrnoException) => {
      if (failure.code !== "ENOENT") throw failure
      return undefined
    })
    if (stat?.isSymbolicLink()) throw new Error("Event log path contains a dangling symlink")
    const parent = path.dirname(file)
    if (parent === file) throw error
    // @scan-suppress security_scan - Canonicalization only; the caller checks containment before any directory or file write.
    return path.join(await canonicalLogPath(parent), path.basename(file))
  }
}

export async function createHeadlessJsonlFileEventSink(file: string, root?: string): Promise<HeadlessEventSink> {
  if (root) {
    // Resolve the leaf and existing ancestors before creating directories or truncating a file.
    file = await canonicalLogPath(path.resolve(root, file))
    if (!Filesystem.contains(await realpath(root), file)) {
      throw new Error("--event-log path resolves outside the current directory")
    }
  }
  await mkdir(path.dirname(file), { recursive: true })
  return createHeadlessFileJsonlEventSink(file)
}

export function createHeadlessFileJsonlEventSink(file: string): HeadlessEventSink {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | (constants.O_NOFOLLOW ?? 0))
  const stream = createWriteStream(file, { fd, autoClose: true })
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
