import type { Readable } from "node:stream"
import { StringDecoder } from "node:string_decoder"
import { parseJsonResult } from "@/util/json-value"
import { parseProgressJsonLine } from "./download-progress"
import { Env } from "@/util/env"

export const DOWNLOAD_OUTPUT_LIMIT = 1024 * 1024

/** Keep subprocess diagnostics safe before they become persisted job errors. */
function redactDownloadDiagnostic(value: string): string {
  return Env.redactSecrets(value.replace(/\bhf_[A-Za-z0-9]{8,}\b/g, "[redacted]"))
}

/** A stderr warning must not hide the helper's terminal error (including MTP). */
export function downloadFailureMessage(input: {
  code: number
  stdout: string
  stderr: string
  lastSummary?: Record<string, unknown>
}): string | undefined {
  let summary = input.lastSummary
  if (!summary) {
    const consume = createDownloadJsonParser((event) => {
      if (event.kind === "summary") summary = event.value
    })
    for (const line of input.stdout.split(/\r?\n/)) consume(line)
  }
  const records = [summary]
  if (summary?.download && typeof summary.download === "object" && !Array.isArray(summary.download)) {
    records.push(summary.download as Record<string, unknown>)
  }
  const errors = records.flatMap((record) => {
    const values: unknown[] = Array.isArray(record?.errors) ? [...record.errors] : []
    values.push(record?.error)
    if (record?.failure && typeof record.failure === "object" && !Array.isArray(record.failure)) {
      values.push((record.failure as Record<string, unknown>).message)
    }
    return values.filter((error): error is string => typeof error === "string" && !!error.trim())
  })
  const failedRecord = records.find(
    (record) =>
      typeof record?.status === "string" &&
      [
        "failed",
        "failure",
        "error",
        "download_failed",
        "validation_failed",
        "manifest_missing",
        "invalid_arguments",
      ].includes(record.status),
  )
  if (input.code === 0 && !failedRecord && errors.length === 0) return undefined
  const classification = records.flatMap((record) => {
    const failure = record?.failure
    if (!failure || typeof failure !== "object" || Array.isArray(failure)) return []
    const code = (failure as Record<string, unknown>).code
    return typeof code === "string" && /^[A-Z][A-Z_]{2,63}$/.test(code) ? [code] : []
  })[0]
  const detail = errors.length
    ? errors
        .slice(0, 8)
        .map((error) => error.trim())
        .join("\n")
    : failedRecord
      ? `ax-engine reported ${String(failedRecord.status)}`
      : [
          `ax-engine download exited with code ${input.code}`,
          input.stdout.trim() ? `stdout:\n${redactDownloadDiagnostic(input.stdout.trim()).slice(-5_000)}` : "",
          input.stderr.trim() ? `stderr:\n${redactDownloadDiagnostic(input.stderr.trim()).slice(-2_000)}` : "",
        ]
          .filter(Boolean)
          .join("\n")
  // Redact before truncation so cutting a credential cannot defeat redaction.
  return redactDownloadDiagnostic(`${classification ? `[${classification}] ` : ""}${detail}`).slice(0, 8_192)
}

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
