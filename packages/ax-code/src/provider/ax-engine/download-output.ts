import type { Readable } from "node:stream"
import { StringDecoder } from "node:string_decoder"
import { parseJsonResult } from "@/util/json-value"
import { parseProgressJsonLine } from "./download-progress"

export const DOWNLOAD_OUTPUT_LIMIT = 1024 * 1024

/** Discard oversized lines through their delimiter, then resume the protocol. */
export async function readDownloadLines(stream: Readable, onLine: (line: string) => void): Promise<void> {
  const decoder = new StringDecoder("utf8")
  let pending = ""
  let pendingBytes = 0
  let dropping = false
  const consume = (text: string) => {
    let start = 0
    while (start < text.length) {
      const newline = text.indexOf("\n", start)
      const end = newline === -1 ? text.length : newline
      if (!dropping) {
        const piece = text.slice(start, end)
        pendingBytes += Buffer.byteLength(piece)
        if (pendingBytes > DOWNLOAD_OUTPUT_LIMIT) {
          pending = ""
          dropping = true
        } else pending += piece
      }
      if (newline === -1) break
      if (!dropping && pending.trim()) onLine(pending)
      pending = ""
      pendingBytes = 0
      dropping = false
      start = newline + 1
    }
  }
  for await (const chunk of stream) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    // Decode bounded pieces even if a producer delivers one oversized chunk.
    for (let offset = 0; offset < bytes.length; offset += 4096)
      consume(decoder.write(bytes.subarray(offset, offset + 4096)))
  }
  consume(decoder.end())
  if (!dropping && pending.trim()) onLine(pending)
}

/** Retain a byte-bounded diagnostic tail without keeping oversized backing buffers. */
export function createDownloadTranscript(maxChunks = Infinity) {
  const chunks: Buffer[] = []
  let bytes = 0
  return {
    append(chunk: Buffer) {
      if (chunk.length >= DOWNLOAD_OUTPUT_LIMIT) {
        chunks.length = 0
        const tail = Buffer.from(chunk.subarray(-DOWNLOAD_OUTPUT_LIMIT))
        chunks.push(tail)
        bytes = tail.length
        return
      }
      chunks.push(chunk)
      bytes += chunk.length
      while (chunks.length > maxChunks) bytes -= chunks.shift()!.length
      while (bytes > DOWNLOAD_OUTPUT_LIMIT) {
        const excess = bytes - DOWNLOAD_OUTPUT_LIMIT
        const first = chunks[0]
        if (first.length <= excess) bytes -= chunks.shift()!.length
        else {
          chunks[0] = Buffer.from(first.subarray(excess))
          bytes -= excess
        }
      }
    },
    text: () => Buffer.concat(chunks, bytes).toString("utf8"),
  }
}

export function createDownloadJsonParser(consume: (parsed: ReturnType<typeof parseProgressJsonLine>) => void) {
  let multiLineJson: string | undefined
  let multiLineBytes = 0
  const tryConsume = (text: string) => {
    const parsed = parseProgressJsonLine(text)
    if (parsed.kind === "ignore") return false
    consume(parsed)
    return true
  }
  return (line: string) => {
    // A complete standalone protocol object rescues progress after malformed output.
    const parsed = parseProgressJsonLine(line)
    const standalone = parseJsonResult(line)
    const completeObject =
      standalone.ok &&
      standalone.value !== null &&
      typeof standalone.value === "object" &&
      !Array.isArray(standalone.value)
    const protocolLine = parsed.kind === "progress" || multiLineJson === undefined || line.startsWith("{")
    if (protocolLine && (parsed.kind !== "ignore" || completeObject)) {
      if (parsed.kind !== "ignore") consume(parsed)
      multiLineJson = undefined
      multiLineBytes = 0
      return
    }
    if (multiLineJson !== undefined) {
      multiLineBytes += 1 + Buffer.byteLength(line)
      if (multiLineBytes > DOWNLOAD_OUTPUT_LIMIT) {
        multiLineJson = undefined
        multiLineBytes = 0
        return
      }
      multiLineJson += `\n${line}`
      // Pretty summaries can only finish on a closing brace. Avoid repeatedly
      // parsing every growing prefix of a large object.
      if (line.trimEnd().endsWith("}") && tryConsume(multiLineJson)) {
        multiLineJson = undefined
        multiLineBytes = 0
      }
      return
    }
    if (line.trimStart().startsWith("{") && Buffer.byteLength(line) <= DOWNLOAD_OUTPUT_LIMIT) {
      multiLineJson = line
      multiLineBytes = Buffer.byteLength(line)
    }
  }
}
