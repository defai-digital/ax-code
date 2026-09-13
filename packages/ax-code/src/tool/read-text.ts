import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import { Readable } from "node:stream"
import { createInterface } from "node:readline"
import type { BigIntStats } from "node:fs"
import z from "zod"
import { MAX_LINE_LENGTH, MAX_LINE_SUFFIX, MAX_BYTES, MAX_BYTES_LABEL } from "../constants/tool"

export const ReadTextResult = z.object({ output: z.string(), preview: z.string(), truncated: z.boolean() })
export const MAX_CACHE_SOURCE_BYTES = 1024 * 1024

export function sameReadSource(left: BigIntStats, right: BigIntStats) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}

/** A bounded source snapshot, not an mtime-only cache admission. */
export async function readSourceSnapshot(filepath: string, signal: AbortSignal) {
  const handle = await fs.open(filepath, "r")
  try {
    const before = await handle.stat({ bigint: true })
    if (!before.isFile() || before.size > BigInt(MAX_CACHE_SOURCE_BYTES)) return undefined
    const buffer = Buffer.alloc(Number(before.size) + 1)
    let used = 0
    while (used < buffer.length) {
      signal.throwIfAborted()
      const { bytesRead } = await handle.read(buffer, used, buffer.length - used, used)
      if (!bytesRead) break
      used += bytesRead
    }
    const after = await handle.stat({ bigint: true })
    const current = await fs.stat(filepath, { bigint: true })
    if (used !== Number(before.size) || !sameReadSource(before, after) || !sameReadSource(after, current)) {
      throw new Error("File changed while reading; retry the read")
    }
    signal.throwIfAborted()
    return { bytes: buffer.subarray(0, used), stamp: after }
  } finally {
    await handle.close()
  }
}

export async function renderReadText(
  filepath: string,
  offset: number,
  limit: number,
  signal: AbortSignal,
  text?: string,
) {
  const stream = text === undefined ? createReadStream(filepath, { encoding: "utf8", signal }) : Readable.from([text])
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const raw: string[] = []
  let bytes = 0
  let lines = 0
  let truncatedByBytes = false
  let hasMoreLines = false
  try {
    for await (const text of rl) {
      signal.throwIfAborted()
      const normalized = lines === 0 && text.startsWith("\uFEFF") ? text.slice(1) : text
      lines++
      if (lines < offset) continue
      if (raw.length >= limit) {
        hasMoreLines = true
        break // One-line lookahead; do not scan to EOF just to count hidden lines.
      }
      const line =
        normalized.length > MAX_LINE_LENGTH ? normalized.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : normalized
      const size = Buffer.byteLength(line) + (raw.length ? 1 : 0)
      if (bytes + size > MAX_BYTES) {
        truncatedByBytes = true
        hasMoreLines = true
        break
      }
      raw.push(line)
      bytes += size
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  signal.throwIfAborted()
  if (!truncatedByBytes && lines < offset && !(lines === 0 && offset === 1)) {
    const error = new Error(`Offset ${offset} is out of range for this file (${lines} lines)`)
    error.name = "ReadOffsetOutOfRangeError"
    throw error
  }
  const last = offset + raw.length - 1
  let output = [`<path>${filepath}</path>`, "<type>file</type>", "<content>"].join("\n")
  output += raw.map((line, i) => `${offset + i}: ${line}`).join("\n")
  if (truncatedByBytes) {
    output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${offset}-${last} of file. Use offset=${last + 1} to continue.)`
  } else if (hasMoreLines) {
    output += `\n\n(Showing lines ${offset}-${last}. More lines remain; total not counted. Use offset=${last + 1} to continue.)`
  } else {
    output += `\n\n(End of file - total ${lines} lines)`
  }
  output += "\n</content>"
  return { output, preview: raw.slice(0, 20).join("\n"), truncated: hasMoreLines || truncatedByBytes }
}
