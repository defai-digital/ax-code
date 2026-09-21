import z from "zod"
import { parseJsonStrict } from "../util/json-value"
import { decodeGrepPath } from "./grep-path"

const Text = z.union([z.object({ text: z.string() }), z.object({ bytes: z.string() })])
const Event = z.object({ type: z.string() }).passthrough()
const Match = z.object({
  data: z.object({ path: Text, lines: Text, line_number: z.number().int().positive() }),
})
const End = z.object({ data: z.object({ binary_offset: z.number().nullish() }) })
const decode = (value: z.infer<typeof Text>) =>
  "text" in value ? value.text : Buffer.from(value.bytes, "base64").toString("utf8")

type SearchMatch = { path: string; modTime: number; lineNum: number; lineText: string }

/** Count every valid match, retaining only the stable newest K candidates. */
export function createGrepCollector(input: {
  limit: number
  isFile: boolean
  mtime: (path: string) => number | undefined
}) {
  const matches: SearchMatch[] = []
  const mtimes = new Map<string, number | undefined>()
  const result = {
    matches,
    totalMatches: 0,
    skippedRecords: false,
    summarySeen: false,
    binaryStopped: false,
    failure: undefined as { error: unknown } | undefined,
  }
  function accept(line: string) {
    if (!line.trim()) return
    const event = Event.parse(parseJsonStrict(line))
    if (event.type === "summary") result.summarySeen = true
    if (event.type === "end" && !input.isFile && End.parse(event).data.binary_offset != null)
      result.binaryStopped = true
    if (event.type !== "match") return
    const record = Match.parse(event).data
    const file = decodeGrepPath(record.path)
    if (file === undefined) {
      result.skippedRecords = true
      return
    }
    if (!mtimes.has(file)) mtimes.set(file, input.mtime(file))
    const modTime = mtimes.get(file)
    if (modTime === undefined) {
      result.skippedRecords = true
      return
    }
    result.totalMatches++
    // Insert AFTER equal timestamps, preserving the stable full-sort order.
    let lo = 0
    let hi = matches.length
    while (lo < hi) {
      const mid = (lo + hi) >>> 1
      if (modTime > matches[mid].modTime) hi = mid
      else lo = mid + 1
    }
    if (lo >= input.limit) return
    matches.splice(lo, 0, {
      path: file,
      modTime,
      lineNum: record.line_number,
      lineText: decode(record.lines).replace(/\r?\n$/, ""),
    })
    if (matches.length > input.limit) matches.pop()
  }
  return {
    result,
    onLine(line: string) {
      // Preserve existing precedence: timeout, signal and exit 1 are handled
      // before malformed protocol output. Keep draining within the byte budget.
      if (result.failure) return
      try {
        accept(line)
      } catch (error) {
        result.failure = { error }
      }
    },
  }
}
