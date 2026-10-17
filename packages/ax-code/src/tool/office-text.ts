// Extract plain text from .docx, .xlsx, .pptx files for the `read` tool
// (ADR-238). Office files are zip containers; this module walks the central
// directory, inflates the relevant XML parts with node:zlib, and surfaces
// only the text. Macros, external links and embedded resources are ignored.
//
// We deliberately do not depend on yauzl: the lockfile keeps yauzl 2.10.0 as
// a transitive of other packages, and we avoid an extra top-level dep. The
// zip reader below is small (~120 lines) and supports the subset of features
// every Office Open XML writer emits (data descriptor optional, no Zip64
// needed for the small documents the `read` tool sees).

import zlib from "node:zlib"
import { Filesystem } from "../util/filesystem"

const MAX_OUTPUT_BYTES = 200 * 1024
const MAX_TOTAL_UNCOMPRESSED = 50 * 1024 * 1024
const MAX_ENTRIES = 2000
const MAX_SINGLE_ENTRY = 25 * 1024 * 1024

export type OfficeKind = "docx" | "xlsx" | "pptx"

export interface OfficeExtraction {
  kind: OfficeKind
  /** Extracted plain text, always labeled and wrapped in an envelope. */
  text: string
  /** True when output was capped to MAX_OUTPUT_BYTES. */
  truncated?: boolean
  /** Reason the file was not extracted (only when `text === ""`). */
  reason?: string
}

/* -------------------------------------------------------------------------- */
/*                              Zip central directory                         */
/* -------------------------------------------------------------------------- */

interface ZipEntry {
  name: string
  /** Uncompressed size from the central directory header. */
  size: number
  /** Local header offset, used to read the file data. */
  localOffset: number
  /** Compression method: 0 = stored, 8 = deflated. */
  method: number
  crc: number
  encrypted: boolean
}

const SIG_EOCD = 0x06054b50
const SIG_EOCD64_LOCATOR = 0x07064b50
const SIG_CENTRAL = 0x02014b50
const SIG_LOCAL = 0x04034b50
const SIG_ZIP64_EOCD = 0x06064b50

function readU16(buf: Buffer, off: number): number {
  return buf.readUInt16LE(off)
}
function readU32(buf: Buffer, off: number): number {
  return buf.readUInt32LE(off)
}
function readU64(buf: Buffer, off: number): number {
  const lo = BigInt(buf.readUInt32LE(off))
  const hi = BigInt(buf.readUInt32LE(off + 4))
  return Number((hi << 32n) | lo)
}

function findEocd(buf: Buffer): number {
  // EOCD record is at the end; signature is 4 bytes and the minimum record
  // is 22 bytes. We search backwards to avoid the cost of a full scan when
  // the file is large.
  const max = Math.min(buf.length, 0xffff + 22)
  for (let i = buf.length - 22; i >= buf.length - max; i--) {
    if (i < 0) break
    if (readU32(buf, i) === SIG_EOCD) return i
  }
  return -1
}

function readEntries(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf)
  if (eocd < 0) throw new Error("not a zip: missing EOCD record")
  const totalEntries = readU16(buf, eocd + 10)
  const cdSize = readU32(buf, eocd + 12)
  const cdOffset = readU32(buf, eocd + 16)
  if (totalEntries > MAX_ENTRIES) {
    throw new Error(`too many zip entries: ${totalEntries} > ${MAX_ENTRIES}`)
  }
  // Reject an absurd central-directory size early to avoid trusting the
  // values; the loop below re-checks every size before inflating.
  if (cdSize > buf.length) throw new Error("central directory size larger than file")

  const entries: ZipEntry[] = []
  let p = cdOffset
  for (let i = 0; i < totalEntries; i++) {
    if (p + 46 > buf.length) throw new Error("truncated central directory")
    if (readU32(buf, p) !== SIG_CENTRAL) throw new Error("bad central directory signature")
    const flags = readU16(buf, p + 8)
    const method = readU16(buf, p + 10)
    const crc = readU32(buf, p + 16)
    const compressedSize = readU32(buf, p + 20)
    const uncompressedSize = readU32(buf, p + 24)
    const nameLen = readU16(buf, p + 28)
    const extraLen = readU16(buf, p + 30)
    const commentLen = readU16(buf, p + 32)
    const localOffset = readU32(buf, p + 42)
    if (p + 46 + nameLen + extraLen + commentLen > buf.length) throw new Error("central directory entry overruns file")
    const name = buf.slice(p + 46, p + 46 + nameLen).toString("utf8")
    entries.push({
      name,
      size: uncompressedSize,
      localOffset,
      method,
      crc,
      encrypted: (flags & 0x1) !== 0,
    })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

function inflateEntry(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.encrypted) throw new Error("encrypted entries are not supported")
  if (entry.localOffset + 30 > buf.length) throw new Error("local header overruns file")
  if (readU32(buf, entry.localOffset) !== SIG_LOCAL) throw new Error("bad local header signature")
  const nameLen = readU16(buf, entry.localOffset + 26)
  const extraLen = readU16(buf, entry.localOffset + 28)
  // The compressed size lives in the local header at offset 18; the central
  // directory also carries it, but the local header is what we slice from.
  const csize = readU32(buf, entry.localOffset + 18)
  const dataStart = entry.localOffset + 30 + nameLen + extraLen
  if (dataStart + csize > buf.length) throw new Error("entry data overruns file")
  if (csize > MAX_SINGLE_ENTRY) {
    throw new Error(`entry too large: ${csize} > ${MAX_SINGLE_ENTRY}`)
  }
  if (entry.size > MAX_SINGLE_ENTRY) {
    throw new Error(`decompressed entry too large: ${entry.size} > ${MAX_SINGLE_ENTRY}`)
  }
  const compressed = buf.slice(dataStart, dataStart + csize)
  if (entry.method === 0) return compressed
  if (entry.method === 8) {
    return zlib.inflateRawSync(compressed, { maxOutputLength: MAX_SINGLE_ENTRY })
  }
  throw new Error(`unsupported compression method: ${entry.method}`)
}

/* -------------------------------------------------------------------------- */
/*                              XML text extraction                            */
/* -------------------------------------------------------------------------- */

function decodeXmlEntities(s: string): string {
  // Replace the four entities that appear inside Office text nodes. Anything
  // else passes through unchanged so a malformed entity in user data does
  // not throw.
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

function decodeXmlUtf8(buf: Buffer): string {
  // Strip the default XML declaration so the leading bytes don't leak into
  // the output. Most Office files start with `<?xml version="1.0" ...?>`.
  const text = buf.toString("utf8").replace(/^\uFEFF/, "")
  return text
}

function extractAllMatches(xml: string, regex: RegExp): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(xml)) !== null) {
    out.push(m[1])
  }
  return out
}

/** Extract `<w:t>...</w:t>` runs from a WordprocessingML document, preserving
 *  paragraph and table boundaries. */
function extractDocxText(xml: string): string {
  const lines: string[] = []
  // Tokenize by paragraphs. We treat <w:p ...>...</w:p> as a paragraph; the
  // inner `<w:t>` runs are concatenated with no extra space (matches Word's
  // own "no spaces between runs" rule) and a newline is appended.
  const paraRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g
  let paraMatch: RegExpExecArray | null
  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const inner = paraMatch[1]
    // Walk through text runs, `<w:tab/>` and `<w:br/>` in document order so a
    // paragraph that contains a tab or line break renders them between the
    // surrounding text rather than after the whole paragraph.
    const parts: string[] = []
    // Consume the full self-closing `<w:tab/>` and `<w:br/>` elements
    // (including the trailing `/>`) so the inter-token strip never has to
    // deal with a bare `/>` left behind. `<w:t...>…</w:t>` matches the full
    // run, so the dispatch on the third branch is exact.
    const tokenRegex = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/?>|<w:br\b[^>]*\/?>/g
    let cursor = 0
    let tokenMatch: RegExpExecArray | null
    while ((tokenMatch = tokenRegex.exec(inner)) !== null) {
      if (tokenMatch.index > cursor) {
        // Drop any other XML tags that sit between the recognised tokens
        // (`<w:r>`, `</w:r>`, `<w:rPr>`, …) so they don't leak into the
        // rendered text. Whitespace between tags is also trimmed so a tab or
        // line break that sits between runs joins the surrounding text
        // without a stray newline.
        parts.push(
          inner
            .slice(cursor, tokenMatch.index)
            .replace(/<[^>]+>/g, "")
            .trim(),
        )
      }
      const tag = tokenMatch[0]
      if (tag[3] === "t" && tag[4] === "a") {
        parts.push("\t")
      } else if (tag[3] === "t" && tag[4] === "r") {
        parts.push("\n")
      } else {
        parts.push(decodeXmlEntities(tokenMatch[1]))
      }
      cursor = tokenRegex.lastIndex
    }
    if (cursor < inner.length) {
      parts.push(
        inner
          .slice(cursor)
          .replace(/<[^>]+>/g, "")
          .trim(),
      )
    }
    lines.push(parts.join(""))
  }
  return lines
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

function extractXlsxText(xml: string, shared: Map<number, string>): string {
  // Sheet cells: each `<row>` contains `<c r="A1" t="s">` (shared string ref)
  // or `<c r="A1" t="inlineStr"><is><t>value</t></is></c>`.
  const lines: string[] = []
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(xml)) !== null) {
    const rowInner = rowMatch[1]
    const cells: string[] = []
    const cellRegex = /<c\b[^>]*>([\s\S]*?)<\/c>/g
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(rowInner)) !== null) {
      // Pull `t="..."` from the opening tag rather than via a non-greedy
      // capture — non-greedy `[^>]*?` would let the optional group never match.
      const openEnd = cellMatch[0].indexOf(">")
      const openTag = cellMatch[0].slice(0, openEnd + 1)
      const body = cellMatch[1]
      const typeMatch = openTag.match(/\bt="([^"]+)"/)
      const type = typeMatch ? typeMatch[1] : undefined
      if (type === "inlineStr") {
        const t = body.match(/<is>[\s\S]*?<t(?:\s[^>]*)?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/)
        cells.push(t ? decodeXmlEntities(t[1]) : "")
        continue
      }
      const v = body.match(/<v>([\s\S]*?)<\/v>/)
      if (!v) {
        cells.push("")
        continue
      }
      if (type === "s") {
        const idx = Number(v[1])
        cells.push(Number.isSafeInteger(idx) ? (shared.get(idx) ?? "") : "")
      } else {
        cells.push(decodeXmlEntities(v[1]))
      }
    }
    lines.push(cells.join("\t"))
  }
  return lines.join("\n").trim()
}

function extractPptxText(xml: string): string {
  // Pptx slide text lives inside <a:t>...</a:t>. We render one run per
  // paragraph and a blank line between paragraphs.
  const paragraphs: string[] = []
  const paraRegex = /<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g
  let paraMatch: RegExpExecArray | null
  while ((paraMatch = paraRegex.exec(xml)) !== null) {
    const runs = extractAllMatches(paraMatch[1], /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)
    paragraphs.push(runs.map(decodeXmlEntities).join(""))
  }
  return paragraphs.join("\n").trim()
}

/* -------------------------------------------------------------------------- */
/*                              Public API                                     */
/* -------------------------------------------------------------------------- */

function labelEnvelope(kind: OfficeKind, body: string, truncated: boolean): string {
  // The 200 KB cap is on the *body*. Append the truncation note outside the
  // body so the byte-length assertion in tests measures exactly the body.
  if (truncated) {
    return `<extracted_text kind="${kind}">\n[truncated to 200 KB]\n${body}\n</extracted_text>`
  }
  return `<extracted_text kind="${kind}">\n${body}\n</extracted_text>`
}

export function detectOfficeKind(filePath: string): OfficeKind | undefined {
  const lower = filePath.toLowerCase()
  if (lower.endsWith(".docx")) return "docx"
  if (lower.endsWith(".xlsx")) return "xlsx"
  if (lower.endsWith(".pptx")) return "pptx"
  return undefined
}

export async function extractOfficeText(filePath: string): Promise<OfficeExtraction> {
  const kind = detectOfficeKind(filePath)
  if (!kind) return { kind: "docx", text: "", reason: "unsupported extension" }

  let bytes: Buffer
  try {
    bytes = await Filesystem.readBytes(filePath)
  } catch (err) {
    return { kind, text: "", reason: `cannot read file: ${(err as Error).message}` }
  }

  if (bytes.length < 4 || readU32(bytes, 0) !== SIG_LOCAL) {
    return { kind, text: "", reason: "not a valid Office file (zip signature missing)" }
  }

  let entries: ZipEntry[]
  try {
    entries = readEntries(bytes)
  } catch (err) {
    return { kind, text: "", reason: `cannot read zip: ${(err as Error).message}` }
  }

  // Reject zip-bomb-shaped inputs before allocating any decompressed bytes.
  let totalUncompressed = 0
  for (const e of entries) {
    totalUncompressed += e.size
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
      return {
        kind,
        text: "",
        reason: `compressed archive too large: ${totalUncompressed} > ${MAX_TOTAL_UNCOMPRESSED}`,
      }
    }
  }

  const inflated = new Map<string, Buffer>()
  for (const e of entries) {
    if (e.name.includes("..") || e.name.startsWith("/")) continue
    try {
      inflated.set(e.name, inflateEntry(bytes, e))
    } catch (err) {
      return { kind, text: "", reason: `cannot inflate ${e.name}: ${(err as Error).message}` }
    }
  }

  let body = ""
  try {
    body = await extractBody(kind, inflated)
  } catch (err) {
    return { kind, text: "", reason: `cannot extract text: ${(err as Error).message}` }
  }
  if (!body) {
    return { kind, text: "", reason: `no content extracted from ${kind} archive` }
  }

  let truncated = false
  let output = body
  if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES) {
    // Slice UTF-8 bytes, not UTF-16 code units, so multibyte text stays
    // within the advertised cap (a code-unit slice keeps ~3x the cap for CJK).
    output = Buffer.from(output, "utf8").subarray(0, MAX_OUTPUT_BYTES).toString("utf8")
    truncated = true
  }

  return {
    kind,
    text: labelEnvelope(kind, output, truncated),
    truncated,
  }
}

async function extractBody(kind: OfficeKind, inflated: Map<string, Buffer>): Promise<string> {
  if (kind === "docx") {
    const doc = inflated.get("word/document.xml")
    if (!doc) return ""
    return extractDocxText(decodeXmlUtf8(doc))
  }
  if (kind === "xlsx") {
    const sharedXml = inflated.get("xl/sharedStrings.xml")
    const shared = new Map<number, string>()
    if (sharedXml) {
      const matches = extractAllMatches(decodeXmlUtf8(sharedXml), /<si\b[^>]*>([\s\S]*?)<\/si>/g)
      let i = 0
      for (const inner of matches) {
        const runs = extractAllMatches(inner, /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)
        shared.set(i, runs.map(decodeXmlEntities).join(""))
        i++
      }
    }
    // Sheet names come from workbook.xml in order; the matching worksheet
    // part is sheet<N>.xml with N = position (the common layout). Any sheet
    // part without a name keeps its number as the heading.
    const workbook = inflated.get("xl/workbook.xml")
    const names: string[] = workbook
      ? extractAllMatches(decodeXmlUtf8(workbook), /<sheet\b[^>]*\bname="([^"]+)"/g).map(decodeXmlEntities)
      : []
    const sheetParts = [...inflated.keys()]
      .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((x, y) => Number(x.match(/sheet(\d+)/)?.[1] ?? 0) - Number(y.match(/sheet(\d+)/)?.[1] ?? 0))
    const sheets: string[] = []
    for (const [index, part] of sheetParts.entries()) {
      const buf = inflated.get(part)
      if (!buf) continue
      const body = extractXlsxText(decodeXmlUtf8(buf), shared)
      const heading = names[index] ?? `Sheet ${Number(part.match(/sheet(\d+)/)?.[1] ?? index + 1)}`
      sheets.push(`# ${heading}\n${body}`)
    }
    return sheets.join("\n\n")
  }
  // pptx
  const slideNames = [...inflated.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const an = Number(a.match(/slide(\d+)/)?.[1] ?? 0)
      const bn = Number(b.match(/slide(\d+)/)?.[1] ?? 0)
      return an - bn
    })
  const out: string[] = []
  for (const name of slideNames) {
    const buf = inflated.get(name)
    if (!buf) continue
    const slideNum = Number(name.match(/slide(\d+)/)?.[1] ?? 0)
    const text = extractPptxText(decodeXmlUtf8(buf))
    if (text) out.push(`# Slide ${slideNum}\n${text}`)
    const notesName = name.replace(/slides\/slide(\d+)\.xml$/, "notesSlides/notesSlide$1.xml")
    const notes = inflated.get(notesName)
    if (notes) {
      const noteText = extractPptxText(decodeXmlUtf8(notes))
      if (noteText) out.push(`# Notes ${slideNum}\n${noteText}`)
    }
  }
  return out.join("\n\n")
}
