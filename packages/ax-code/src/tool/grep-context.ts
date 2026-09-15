import z from "zod"
import { StringDecoder } from "node:string_decoder"
import { Ripgrep } from "../file/ripgrep"
import { Process } from "../util/process"
import { Env } from "../util/env"
import { MAX_LINE_LENGTH } from "../constants/tool"
import type { CanonicalOutput } from "./canonical-output"
import { parseJsonStrict } from "../util/json-value"

const MAX_LINES = 200
const MAX_BYTES = 32 * 1024
const MAX_RECORD_BYTES = 1024 * 1024
const TIMEOUT_MS = 120_000
const Text = z.union([z.object({ text: z.string() }), z.object({ bytes: z.string() })])
const Event = z.object({ type: z.string() }).passthrough()
const Record = z.object({
  type: z.enum(["match", "context"]),
  data: z.object({ path: Text, lines: Text, line_number: z.number().int().positive() }),
})
const decode = (value: z.infer<typeof Text>) =>
  "text" in value ? value.text : Buffer.from(value.bytes, "base64").toString("utf8")

/** One source scan, with merged context from ripgrep rather than a second file read. */
export async function searchWithContext(
  params: { pattern: string; path: string; include?: string; context: number; limit: number },
  abort: AbortSignal,
) {
  abort.throwIfAborted()
  const args = [
    "--json",
    "--hidden",
    "--glob",
    "!.git",
    "--context",
    String(params.context),
    "--regexp",
    params.pattern,
  ]
  if (params.include) args.push("--glob", params.include)
  args.push("--", params.path)
  const proc = Process.spawn([await Ripgrep.filepath(), ...args], {
    stdout: "pipe",
    stderr: "pipe",
    abort,
    env: Env.sanitize(),
    timeout: TIMEOUT_MS,
  })
  const data: z.infer<typeof CanonicalOutput.Grep> = { matches: [], context: [], truncated: false }
  const output: string[] = []
  let bytes = 0
  let errors = ""
  // Always drain stderr, but retain only a bounded diagnostic.
  proc.stderr!.on("data", (chunk: Buffer) => {
    errors = (errors + chunk.toString("utf8")).slice(0, 2000)
  })
  let summarySeen = false
  // ripgrep streams a match's _before-context_ rows before the match row itself.
  // Holding them until their match is accepted keeps a match rejected by the
  // line/byte budget from leaving its context rendered with no match.
  // Attribution is per file so the logic does not depend on ripgrep's per-file
  // block ordering: a row can only be before-context of a match in the same
  // file, and pending rows are discarded if that match never arrives. Buffered
  // rows count against the same budgets as emitted rows.
  const pendingBeforeContext = new Map<
    string,
    { entry: { path: string; line: number; text: string; isMatch: boolean }; rendered: string; size: number }[]
  >()
  const lastAcceptedMatchLine = new Map<string, number>()
  let bufferedLines = 0
  let bufferedBytes = 0
  // A context row is a match's after-context when it sits within the context
  // window that follows it in the same file. Rows past that window are
  // before-context of a later match, so they are buffered instead.
  const isAfterContext = (file: string, line: number) => {
    const matchLine = lastAcceptedMatchLine.get(file)
    return matchLine !== undefined && line > matchLine && line - matchLine <= params.context
  }
  const accept = (line: string) => {
    if (!line.trim()) return true
    const event = Event.parse(parseJsonStrict(line))
    if (event.type === "summary") summarySeen = true
    if (event.type !== "match" && event.type !== "context") return true
    const record = Record.parse(event)
    const isMatch = record.type === "match"
    if (isMatch && data.matches.length >= params.limit) return false
    const file = decode(record.data.path)
    const source = decode(record.data.lines).replace(/\r?\n$/, "")
    // A clamped source line is not a dropped result: it stays in the output with
    // a trailing ellipsis, so it must not set the whole-result `truncated` flag.
    // The non-context grep path reports truncated=false for the same input, and
    // `truncated` means "results were capped", not "a line was shortened".
    let text = source.slice(0, MAX_LINE_LENGTH)
    if (text.length < source.length) {
      // Do not split a surrogate pair at the cut: a lone surrogate is invalid
      // UTF-16 and renders as a replacement glyph in the tool output.
      const last = text.charCodeAt(text.length - 1)
      if (last >= 0xd800 && last <= 0xdbff) text = text.slice(0, -1)
    }
    const entry = { path: file, line: record.data.line_number, text, isMatch }
    const rendered = `${file}:${entry.line}${isMatch ? ":" : "-"} ${text}${text.length < source.length ? "..." : ""}`
    const size = Buffer.byteLength(rendered) + 1
    if (!isMatch) {
      if (isAfterContext(file, entry.line)) {
        if (data.context!.length >= MAX_LINES || bytes + size > MAX_BYTES) return false
        bytes += size
        data.context!.push(entry)
        output.push(rendered)
        return true
      }
      // A possible before-context row: hold it until its match arrives. It is
      // discarded if that match never comes (budget stop or an absent match), so
      // it can never surface as an orphan, and it still counts against the
      // budgets. A match has at most `context` before-context rows.
      const bucket = pendingBeforeContext.get(file) ?? []
      if (bucket.length >= params.context) return false
      if (data.context!.length + bufferedLines >= MAX_LINES || bytes + bufferedBytes + size > MAX_BYTES) return false
      bucket.push({ entry, rendered, size })
      pendingBeforeContext.set(file, bucket)
      bufferedLines++
      bufferedBytes += size
      return true
    }
    // Commit the match together with the before-context it owns, or drop both
    // when the budget cannot fit the pair.
    const before = pendingBeforeContext.get(file) ?? []
    if (data.context!.length + bufferedLines + 1 > MAX_LINES || bytes + bufferedBytes + size > MAX_BYTES) {
      return false
    }
    const beforeBytes = before.reduce((sum, item) => sum + item.size, 0)
    pendingBeforeContext.delete(file)
    bufferedLines -= before.length
    bufferedBytes -= beforeBytes
    for (const item of before) {
      bytes += item.size
      data.context!.push(item.entry)
      output.push(item.rendered)
    }
    bytes += size
    data.context!.push(entry)
    data.matches.push({ path: file, line: entry.line, text })
    output.push(rendered)
    lastAcceptedMatchLine.set(file, entry.line)
    return true
  }
  let stopped = false
  let code: number
  try {
    const decoder = new StringDecoder("utf8")
    let pending = ""
    let pendingBytes = 0
    // Process.spawn closes pipes after exit to avoid inherited-descriptor hangs.
    // Event-based draining consumes buffered data without the async iterator's
    // synthetic ERR_STREAM_PREMATURE_CLOSE on that intentional close.
    await new Promise<void>((resolve, reject) => {
      const stdout = proc.stdout!
      const cleanup = () => {
        stdout.off("data", onData)
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
      const onData = (chunk: Buffer) => {
        try {
          abort.throwIfAborted()
          const decoded = decoder.write(chunk)
          let start = 0
          for (let end = decoded.indexOf("\n"); end >= 0; end = decoded.indexOf("\n", start)) {
            const fragment = decoded.slice(start, end)
            if (pendingBytes + Buffer.byteLength(fragment) > MAX_RECORD_BYTES || !accept(pending + fragment)) {
              stopped = true
              break
            }
            pending = ""
            pendingBytes = 0
            start = end + 1
          }
          if (!stopped) {
            const rest = decoded.slice(start)
            pendingBytes += Buffer.byteLength(rest)
            stopped = pendingBytes > MAX_RECORD_BYTES
            if (!stopped) pending += rest
          }
          if (stopped) {
            stdout.pause()
            finish()
          }
        } catch (error) {
          stdout.pause()
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      }
      stdout.on("data", onData)
      stdout.once("end", finish)
      stdout.once("close", finish)
      stdout.once("error", fail)
    })
    if (!stopped && !accept(pending + decoder.end())) stopped = true
    if (stopped) {
      data.truncated = true
      await Process.stop(proc)
    }
    code = await proc.exited
    abort.throwIfAborted()
  } catch (error) {
    abort.throwIfAborted()
    throw error
  } finally {
    // Own the subprocess on parse failure, cancellation and early budget exit.
    if (proc.exitCode === null && proc.signalCode === null) await Process.stop(proc)
    await proc.exited
  }
  if (!stopped && code === 124) throw new Error(`grep command timed out after ${TIMEOUT_MS / 1000}s`)
  if (!stopped && code !== 0 && code !== 1 && !(code === 2 && data.matches.length))
    throw new Error(`ripgrep failed: ${errors}`)
  if (!stopped && (code === 2 || !summarySeen)) data.truncated = true
  // Before-context rows that never found their match are not rendered (they
  // would be orphans). Real ripgrep does not emit them, so this only fires on an
  // abnormal stream; report it as truncated rather than silently dropping rows.
  if (!stopped && bufferedLines > 0) {
    data.truncated = true
    pendingBeforeContext.clear()
    bufferedLines = 0
    bufferedBytes = 0
  }

  const header = data.truncated
    ? `Showing ${data.matches.length} matches (results or context truncated; narrow the path or pattern).`
    : `Found ${data.matches.length} matches`
  const renderedOutput =
    !data.matches.length && !data.truncated
      ? "No files found"
      : [header, ...output, ...(!stopped && code === 2 ? ["(Some paths were inaccessible and skipped)"] : [])].join(
          "\n",
        )
  return {
    title: params.pattern,
    data,
    metadata: {
      matches: data.matches.length,
      truncated: data.truncated,
      context: params.context,
      returnedLines: data.context!.length,
      outputBytes: Buffer.byteLength(renderedOutput),
    },
    output: renderedOutput,
  }
}
