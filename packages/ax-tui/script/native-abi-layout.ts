/**
 * 64-bit C layout of the FFI structs declared with bun-ffi-structs.
 *
 * The committed contract is `native/renderer/abi-layout.json`. `check:abi`
 * recomputes that layout from `src/core/zig-structs.ts`. The Zig suite checks
 * the same file against `@sizeOf` and `@offsetOf` of the extern structs.
 * A version number alone cannot prove those layouts still match.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
export const ABI_LAYOUT_PATH = join(ROOT, "native/renderer/abi-layout.json")
const STRUCT_SOURCE = join(ROOT, "src/core/zig-structs.ts")

/** TypeScript `defineStruct` export, then the Zig `extern struct` it must match. */
export const ABI_STRUCTS = {
  StyledChunkStruct: "StyledChunk",
  HighlightStruct: "ExternalHighlight",
  LogicalCursorStruct: "ExternalLogicalCursor",
  VisualCursorStruct: "ExternalVisualCursor",
  TerminalCapabilitiesStruct: "ExternalCapabilities",
  EncodedCharStruct: "EncodedChar",
  LineInfoStruct: "ExternalLineInfo",
  MeasureResultStruct: "ExternalMeasureResult",
  CursorStateStruct: "ExternalCursorState",
  CursorStyleOptionsStruct: "CursorStyleOptions",
  GridDrawOptionsStruct: "ExternalGridDrawOptions",
  BuildOptionsStruct: "ExternalBuildOptions",
  AllocatorStatsStruct: "ExternalAllocatorStats",
  NativeRenderStatsStruct: "ExternalRenderStats",
  NativeSpanFeedOptionsStruct: "NativeSpanFeedOptions",
  NativeSpanFeedStatsStruct: "NativeSpanFeedStats",
  SpanInfoStruct: "SpanInfo",
  ReserveInfoStruct: "ReserveInfo",
  AudioCreateOptionsStruct: "AudioCreateOptions",
  AudioStartOptionsStruct: "AudioStartOptions",
  AudioVoiceOptionsStruct: "AudioVoiceOptions",
  AudioStatsStruct: "AudioStats",
} as const

const WIDTH: Record<string, number> = {
  u8: 1,
  bool_u8: 1,
  u16: 2,
  u32: 4,
  u64: 8,
  f32: 4,
  f64: 8,
  "char*": 8,
  pointer: 8,
}

export interface AbiField {
  name: string
  offset: number
  size: number
  alignment: number
}

export interface AbiStruct {
  zig: string
  size: number
  alignment: number
  fields: AbiField[]
}

export interface AbiLayout {
  pointerWidth: 8
  structs: AbiStruct[]
}

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

export function layoutOf(fields: Array<{ name: string; size: number }>): {
  size: number
  alignment: number
  fields: AbiField[]
} {
  let offset = 0
  let alignment = 1
  const laid: AbiField[] = []
  for (const field of fields) {
    if (field.size <= 0 || (field.size & (field.size - 1)) !== 0) {
      throw new Error(`FFI field ${field.name} has a non power-of-two size ${field.size}`)
    }
    offset = alignUp(offset, field.size)
    laid.push({ name: field.name, offset, size: field.size, alignment: field.size })
    alignment = Math.max(alignment, field.size)
    offset += field.size
  }
  return { size: alignUp(offset, alignment), alignment, fields: laid }
}

function skipString(source: string, index: number): number {
  const quote = source[index]
  let next = index + 1
  while (next < source.length) {
    if (source[next] === "\\") {
      next += 2
      continue
    }
    if (source[next] === quote) return next + 1
    next += 1
  }
  throw new Error("Unclosed string in FFI struct source")
}

function matchBracket(source: string, open: number): number {
  const pairs: Record<string, string> = { "[": "]", "{": "}", "(": ")" }
  const close = pairs[source[open]!]
  if (!close) throw new Error(`Not a bracket: ${source[open]}`)
  let depth = 1
  for (let index = open + 1; index < source.length; index += 1) {
    const char = source[index]!
    if (char === "'" || char === '"') {
      index = skipString(source, index) - 1
      continue
    }
    if (char === source[open]) depth += 1
    else if (char === close) {
      depth -= 1
      if (depth === 0) return index
    }
  }
  throw new Error("Unclosed bracket in FFI struct source")
}

function topLevelItems(source: string, open: number, close: number): string[] {
  const items: string[] = []
  let start = open + 1
  let depth = 0
  for (let index = open + 1; index < close; index += 1) {
    const char = source[index]!
    if (char === "'" || char === '"') {
      index = skipString(source, index) - 1
      continue
    }
    if (char === "[" || char === "{" || char === "(") depth += 1
    else if (char === "]" || char === "}" || char === ")") depth -= 1
    else if (char === "," && depth === 0) {
      items.push(source.slice(start, index).trim())
      start = index + 1
    }
  }
  const tail = source.slice(start, close).trim()
  if (tail) items.push(tail)
  return items
}

function fieldType(typeSource: string, enums: Map<string, string>): { size: number } {
  const text = typeSource.trim()
  if (text.startsWith("[")) return { size: 8 }
  const literal = text.match(/^"([^"]+)"$/)
  const name = literal?.[1] ?? enums.get(text)
  const size = name ? WIDTH[name] : undefined
  if (!size) throw new Error(`Unknown FFI field type: ${text}`)
  return { size }
}

export function parseAbiStructs(source: string): AbiLayout {
  const enums = new Map<string, string>()
  for (const match of source.matchAll(/const\s+([A-Za-z0-9_]+)\s*=\s*defineEnum\(/g)) {
    const open = source.indexOf("(", match.index! + match[0].length - 1)
    const close = matchBracket(source, open)
    const underlying = source.slice(open, close).match(/,\s*"([^"]+)"\s*$/)
    if (!underlying?.[1]) throw new Error(`defineEnum ${match[1]} has no underlying integer type`)
    enums.set(match[1]!, underlying[1])
  }

  const found = new Map<string, Array<{ name: string; size: number }>>()
  for (const match of source.matchAll(/export const\s+([A-Za-z0-9_]+)\s*=\s*defineStruct\s*\(/g)) {
    const open = source.indexOf("[", match.index! + match[0].length)
    const close = matchBracket(source, open)
    const fields = topLevelItems(source, open, close).map((item) => {
      const bodyOpen = item.indexOf("[")
      const bodyClose = matchBracket(item, bodyOpen)
      const parts = topLevelItems(item, bodyOpen, bodyClose)
      const name = parts[0]?.match(/^"([^"]+)"$/)?.[1]
      const type = parts[1]
      if (!name || !type) throw new Error(`Malformed FFI field: ${item}`)
      return { name, size: fieldType(type, enums).size }
    })
    found.set(match[1]!, fields)
  }

  const structs = Object.entries(ABI_STRUCTS).map(([typescript, zig]) => {
    const fields = found.get(typescript)
    if (!fields) throw new Error(`Missing defineStruct export ${typescript}`)
    return { zig, ...layoutOf(fields) }
  })
  const extras = [...found.keys()].filter((name) => !(name in ABI_STRUCTS))
  if (extras.length) throw new Error(`defineStruct exports missing from ABI_STRUCTS: ${extras.join(", ")}`)
  return { pointerWidth: 8, structs }
}

export function readAbiLayout(path = ABI_LAYOUT_PATH): AbiLayout {
  return JSON.parse(readFileSync(path, "utf8")) as AbiLayout
}

export function abiLayoutsEqual(actual: AbiLayout, expected: AbiLayout): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected)
}

function main(): void {
  const layout = parseAbiStructs(readFileSync(STRUCT_SOURCE, "utf8"))
  if (process.argv.includes("--write")) {
    writeFileSync(ABI_LAYOUT_PATH, `${JSON.stringify(layout, null, 2)}\n`)
    console.log(`Wrote ${layout.structs.length} FFI struct layouts`)
    return
  }
  const committed = readAbiLayout()
  if (!abiLayoutsEqual(layout, committed)) {
    throw new Error(
      "FFI struct layout drifted from native/renderer/abi-layout.json. " +
        "Run: pnpm exec tsx script/native-abi-layout.ts --write",
    )
  }
  console.log(`FFI struct layouts match the native contract (${layout.structs.length} structs)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
