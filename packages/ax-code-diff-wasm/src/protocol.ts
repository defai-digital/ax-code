import { parseJsonStrict } from "@ax-code/util/json-value"

export const ABI_VERSION = 1
export const MAX_INPUT_BYTES = 16 * 1024 * 1024
const MAX_OUTPUT_BYTES = 1024 * 1024
const encoder = new TextEncoder()

export type DuplicateGroup = { indices: number[]; score: number }
export type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }
/**
 * `approximate` is present, and `true`, only when the edit-distance work budget ran out and the
 * preview fell back to a coarser but still exact-applying edit script. Exact previews omit it.
 */
export type DiffPreview = { version: 1; additions: number; deletions: number; hunks: Hunk[]; approximate?: true }
export type PatchChunk = { old_lines: string[]; new_lines: string[]; change_context?: string; is_end_of_file?: boolean }
export type Operation =
  | { type: "compare"; tokensJson: string; threshold: number }
  | { type: "diff"; before: string; after: string; normalize: boolean }
  | { type: "hunks"; original: string; hunksJson: string }
  | { type: "patch"; file: string; original: string; chunksJson: string }
export type Request = Operation & { id: number }
export type Reply =
  | { type: "ready"; version: number }
  | { type: "result"; id: number; json: string }
  | { type: "error"; id: number; message: string }

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function encodeRows(rows: readonly (readonly string[])[], threshold: number): string {
  if (!Number.isFinite(threshold)) throw new TypeError("Duplicate threshold must be finite")
  if (!Array.isArray(rows) || rows.length > 10_000) throw new RangeError("Duplicate row limit exceeded")
  let entries = 0
  let bytes = 0
  for (const row of rows) {
    if (!Array.isArray(row) || (entries += row.length) > 200_000)
      throw new RangeError("Duplicate token entry limit exceeded")
    for (const token of row) {
      if (typeof token !== "string" || !token.isWellFormed())
        throw new TypeError("Duplicate tokens must be well-formed Unicode strings")
      // Bound the allocation before encoding a potentially enormous string.
      if (token.length > MAX_INPUT_BYTES || (bytes += encoder.encode(token).byteLength) > MAX_INPUT_BYTES)
        throw new RangeError("Duplicate input byte limit exceeded")
    }
  }
  const json = JSON.stringify(rows)
  if (encoder.encode(json).byteLength > MAX_INPUT_BYTES) throw new RangeError("Duplicate input byte limit exceeded")
  return json
}

export function parseReply(value: unknown): Reply {
  if (!record(value)) throw new Error("Invalid Wasm worker response")
  if (value.type === "ready") {
    if (value.version !== ABI_VERSION) throw new Error("Invalid Wasm worker ABI version")
    return { type: "ready", version: ABI_VERSION }
  }
  if (!Number.isSafeInteger(value.id) || (value.id as number) < 1) throw new Error("Invalid Wasm response ID")
  const id = value.id as number
  if (value.type === "result" && typeof value.json === "string") return { type: "result", id, json: value.json }
  if (value.type === "error" && typeof value.message === "string" && value.message.length <= 2048)
    return { type: "error", id, message: value.message }
  throw new Error("Invalid Wasm worker response or ABI version")
}

export function decodeGroups(json: string, rowCount: number): DuplicateGroup[] {
  if (json.length > MAX_OUTPUT_BYTES || encoder.encode(json).byteLength > MAX_OUTPUT_BYTES)
    throw new RangeError("Duplicate output byte limit exceeded")
  const value = parseJsonStrict(json)
  if (!record(value) || value.version !== ABI_VERSION || !Array.isArray(value.groups) || value.groups.length > rowCount)
    throw new Error("Invalid Wasm duplicate groups")
  const groups: DuplicateGroup[] = []
  const seen = new Set<number>()
  let previous = -1
  for (const group of value.groups) {
    if (
      !record(group) ||
      !Array.isArray(group.indices) ||
      group.indices.length < 2 ||
      group.indices.length > rowCount ||
      typeof group.score !== "number" ||
      !Number.isFinite(group.score) ||
      group.score < 0 ||
      group.score > 1
    )
      throw new Error("Invalid Wasm duplicate group")
    const indices: number[] = []
    let last = -1
    for (const index of group.indices) {
      if (
        typeof index !== "number" ||
        !Number.isInteger(index) ||
        index <= last ||
        index >= rowCount ||
        seen.has(index)
      )
        throw new Error("Invalid Wasm duplicate membership")
      seen.add(index)
      indices.push(index)
      last = index
    }
    if (indices[0]! <= previous) throw new Error("Invalid Wasm duplicate order")
    previous = indices[0]!
    groups.push({ indices, score: group.score })
  }
  return groups
}

export function checkedText(value: unknown, max = MAX_INPUT_BYTES): string {
  if (typeof value !== "string" || !value.isWellFormed()) throw new TypeError("Expected well-formed Unicode text")
  if (value.length > max || encoder.encode(value).byteLength > max) throw new RangeError("Diff byte limit exceeded")
  return value
}
export function encodeHunks(hunks: readonly Hunk[]): string {
  if (!Array.isArray(hunks) || hunks.length > 4096) throw new RangeError("Hunk limit exceeded")
  // Validate before serialization, bounding nested arrays and strings as well.
  let bytes = 0,
    lines = 0
  for (const hunk of hunks) {
    validateHunk(hunk)
    lines += hunk.lines.length
    for (const line of hunk.lines) bytes += encoder.encode(line).byteLength
    if (lines > 400000 || bytes > MAX_INPUT_BYTES) throw new RangeError("Hunk input limit exceeded")
  }
  return checkedText(JSON.stringify(hunks))
}
function validateHunk(value: unknown): asserts value is Hunk {
  if (!record(value) || !Array.isArray(value.lines) || value.lines.length > 400000) throw new Error("Invalid diff hunk")
  for (const key of ["oldStart", "oldLines", "newStart", "newLines"])
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < (key.endsWith("Start") ? 1 : 0))
      throw new Error("Invalid diff hunk coordinates")
  let bytes = 0
  for (const line of value.lines) {
    bytes += encoder.encode(checkedText(line)).byteLength
    if (bytes > MAX_INPUT_BYTES) throw new RangeError("Hunk byte limit exceeded")
  }
}
export function decodePreview(json: string): DiffPreview {
  checkedText(json)
  const value = parseJsonStrict(json)
  if (!record(value) || value.version !== 1 || !Array.isArray(value.hunks) || value.hunks.length > 4096)
    throw new Error("Invalid diff preview")
  for (const key of ["additions", "deletions"])
    if (!Number.isSafeInteger(value[key]) || (value[key] as number) < 0) throw new Error("Invalid diff counts")
  if ("approximate" in value && value.approximate !== true) throw new Error("Invalid diff approximation flag")
  for (const hunk of value.hunks) validateHunk(hunk)
  return value as DiffPreview
}
export function encodeChunks(chunks: readonly PatchChunk[]): string {
  if (!Array.isArray(chunks) || chunks.length > 4096) throw new RangeError("Patch chunk limit exceeded")
  let count = 0,
    bytes = 0
  for (const chunk of chunks) {
    if (!record(chunk)) throw new Error("Invalid patch chunk")
    for (const lines of [chunk.old_lines, chunk.new_lines]) {
      if (!Array.isArray(lines) || (count += lines.length) > 200000) throw new RangeError("Patch line limit exceeded")
      for (const line of lines) {
        bytes += encoder.encode(checkedText(line)).byteLength
        if (bytes > MAX_INPUT_BYTES) throw new RangeError("Patch byte limit exceeded")
      }
    }
    if (chunk.change_context !== undefined) {
      bytes += encoder.encode(checkedText(chunk.change_context)).byteLength
      if (bytes > MAX_INPUT_BYTES) throw new RangeError("Patch byte limit exceeded")
    }
    if (chunk.is_end_of_file !== undefined && typeof chunk.is_end_of_file !== "boolean")
      throw new Error("Invalid EOF flag")
  }
  return checkedText(JSON.stringify(chunks))
}
export function parseRequest(value: unknown): Request {
  if (!record(value) || !Number.isSafeInteger(value.id) || (value.id as number) < 1)
    throw new Error("Invalid Wasm worker request")
  switch (value.type) {
    case "compare":
      checkedText(value.tokensJson as string)
      if (typeof value.threshold !== "number" || !Number.isFinite(value.threshold)) throw new Error("Invalid threshold")
      break
    case "diff":
      checkedText(value.before as string)
      checkedText(value.after as string)
      if (typeof value.normalize !== "boolean") throw new Error("Invalid normalization option")
      break
    case "hunks":
      checkedText(value.original as string)
      checkedText(value.hunksJson as string)
      break
    case "patch":
      checkedText(value.file as string)
      checkedText(value.original as string)
      checkedText(value.chunksJson as string)
      break
    default:
      throw new Error("Invalid Wasm operation")
  }
  return value as Request
}
