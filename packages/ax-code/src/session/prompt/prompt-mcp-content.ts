import { MessageV2 } from "../message-v2"
import { truncateUtf8Bytes } from "@/tool/bash-helpers"
import { isRecord } from "@/util/record"
import { parseJsonResult } from "@/util/json-value"

type McpToolContentItem = {
  type: string
  text?: string
  mimeType?: string
  data?: string
  resource?: {
    text?: string
    blob?: string
    mimeType?: string
    uri?: string
  }
}

// Untrusted MCP content bounds. A hostile server or page tool must not
// exhaust memory, session storage or the truncation directory with giant
// texts or binary attachments; over-limit content degrades to a placeholder.
// The text budget is enforced WHILE collecting: bounding only the joined
// output would still allocate one full copy per part plus the join buffer.
const MAX_MCP_ATTACHMENTS = 10
const MAX_MCP_ATTACHMENT_BASE64 = 8 * 1024 * 1024
const MAX_MCP_ATTACHMENTS_TOTAL_BASE64 = 16 * 1024 * 1024
const MAX_MCP_TEXT_BYTES = 8 * 1024 * 1024
const MAX_MCP_FILENAME = 1024
const MAX_MCP_SERVER_METADATA_BYTES = 16 * 1024
export const MAX_MCP_HOOK_FEEDBACK_BYTES = 64 * 1024
const MAX_MCP_JSON_DEPTH = 64
// Pretty-printed base64 wraps every ~76 chars (~3% overhead). The raw-length
// pre-gate allows this slack past the caps, so near-cap wrapped payloads
// still validate while the compaction copy stays hard-bounded.
const MAX_MCP_BASE64_SLACK = 256 * 1024
// Rejected attachment bytes scanned before the walk stops. Stored bytes need
// no scan cap (the 16 MiB total bounds them); only rejected scans accumulate.
const MAX_MCP_DROPPED_SCAN_BYTES = 64 * 1024 * 1024
// Consecutive scan-costly items (measured base64, validated payloads) that
// keep neither text nor attachment before the walk stops. O(1) skips
// (unknown types, empty text) never consume this budget; they have their
// own far higher cap below, so a long benign list cannot drop a trailing
// real summary.
const MAX_MCP_IDLE_ITEMS = 1024
// Unsupported-but-benign content items (resource_link, audio, empty text)
// skipped before the walk stops. Skipping is O(1) with no scan cost, so
// the cap only bounds the walk itself, not attacker rejection pressure.
const MAX_MCP_SKIPPED_ITEMS = 100_000
const MCP_SCAN_STOPPED = "[MCP content scan stopped: too much rejected content]"
const MCP_SCAN_STOPPED_SKIPPED = "[MCP content scan stopped: too many unsupported items]"
const MIME_PATTERN = /^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/

function validMcpMimeType(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length <= 128 && MIME_PATTERN.test(value) ? value : fallback
}

type McpImageKind = "png" | "jpeg" | "gif" | "webp"

// Providers accept a narrow image set; anything else (svg with script
// potential, tiff, bmp, application/* masquerading as image/*) degrades to a
// placeholder instead of poisoning every later provider request.
const MCP_IMAGE_TYPES: Record<string, McpImageKind> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/gif": "gif",
  "image/webp": "webp",
}

function mcpImageMagicMatches(kind: McpImageKind, bytes: Buffer): boolean {
  switch (kind) {
    case "png":
      return (
        bytes.length >= 8 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[4] === 0x0d &&
        bytes[5] === 0x0a &&
        bytes[6] === 0x1a &&
        bytes[7] === 0x0a
      )
    case "jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case "gif":
      return (
        bytes.length >= 6 &&
        bytes[0] === 0x47 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x38 &&
        (bytes[4] === 0x37 || bytes[4] === 0x39) &&
        bytes[5] === 0x61
      )
    case "webp":
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 &&
        bytes[1] === 0x49 &&
        bytes[2] === 0x46 &&
        bytes[3] === 0x46 &&
        bytes[8] === 0x57 &&
        bytes[9] === 0x45 &&
        bytes[10] === 0x42 &&
        bytes[11] === 0x50
      )
  }
}

/**
 * Declared image bytes must open with the format's magic signature, so a
 * mislabeled HTML or text payload cannot ride into session history as an
 * image part. Reads only a short head prefix off the raw payload (skipping
 * wrapping whitespace), so a magic mismatch never compacts the full body
 * first. Full magic forgery still needs a real image decoder, which stays
 * the provider's job.
 */
function mcpImageMagicOkRaw(kind: McpImageKind, data: string): boolean {
  let head = ""
  for (let index = 0; index < data.length && head.length < 24; index++) {
    const char = data[index]
    if (char === undefined) break
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f" || char === "\v") continue
    head += char
  }
  if (head.length < 4) return false
  try {
    return mcpImageMagicMatches(kind, Buffer.from(head, "base64"))
  } catch {
    return false
  }
}

/**
 * Zero-copy base64 measurement: one scan validates the charset, the padding
 * placement and the length, so a hostile multi-hundred-megabyte payload is
 * rejected before any compaction copy exists. Only the six common ASCII
 * whitespace chars are tolerated; anything else fails closed.
 */
function measureBase64(data: string): { length: number; hasWhitespace: boolean } | undefined {
  let length = 0
  let padding = 0
  let hasWhitespace = false
  for (let index = 0; index < data.length; index++) {
    const code = data.charCodeAt(index)
    if (code === 32 || code === 9 || code === 10 || code === 13 || code === 12 || code === 11) {
      hasWhitespace = true
      continue
    }
    if (code === 61) {
      padding++
      length++
      continue
    }
    const valid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      code === 43 ||
      code === 47
    if (!valid || padding > 0) return undefined
    length++
  }
  if (length === 0 || length % 4 !== 0 || padding > 2) return undefined
  return { length, hasWhitespace }
}

export function collectMcpToolContent(content: McpToolContentItem[]) {
  const textParts: string[] = []
  const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
  let totalBase64 = 0
  let textBytes = 0
  let textCapped = false
  let droppedScanBytes = 0
  let idleItems = 0
  let skippedItems = 0
  // O(1) skips (unsupported types, empty text, content-less resources) share
  // one far-higher cap; returns true when the walk must stop. Skips never
  // touch the rejected-idle budget, so a long benign list cannot drop a
  // trailing real summary or misreport a rejection flood.
  const skipItem = (): boolean => {
    skippedItems++
    if (skippedItems >= MAX_MCP_SKIPPED_ITEMS) {
      pushText(MCP_SCAN_STOPPED_SKIPPED)
      return true
    }
    return false
  }
  const pushText = (part: string) => {
    if (textCapped) return
    // Parts join with "\n\n" downstream, so the separator counts too;
    // otherwise a flood of tiny parts smuggles ~2 bytes each past the cap.
    const separator = textParts.length > 0 ? 2 : 0
    const bytes = separator + Buffer.byteLength(part, "utf8")
    if (textBytes + bytes <= MAX_MCP_TEXT_BYTES) {
      textParts.push(part)
      textBytes += bytes
      return
    }
    textParts.push(truncateUtf8Bytes(part, Math.max(0, MAX_MCP_TEXT_BYTES - textBytes - separator)))
    textParts.push(MCP_TEXT_TRUNCATED)
    textCapped = true
  }
  // Drops a scanned payload, stopping the walk once rejected scans pile up.
  // Returns "stop" when the caller must break out of the content loop.
  const dropScanned = (dataLength: number, message: string): "dropped" | "stop" => {
    droppedScanBytes += dataLength
    if (droppedScanBytes > MAX_MCP_DROPPED_SCAN_BYTES) {
      pushText(MCP_SCAN_STOPPED)
      return "stop"
    }
    pushText(message)
    return "dropped"
  }
  const pushAttachment = (
    mime: string,
    data: string,
    filename?: string,
    imageKind?: McpImageKind,
  ): "stored" | "dropped" | "stop" => {
    if (attachments.length >= MAX_MCP_ATTACHMENTS) {
      pushText("[MCP attachment dropped: too many attachments in one result]")
      return "dropped"
    }
    if (totalBase64 >= MAX_MCP_ATTACHMENTS_TOTAL_BASE64) {
      pushText("[MCP attachment dropped: exceeds the attachment size limit]")
      return "dropped"
    }
    // Raw pre-gate in O(1): the raw length over-approximates the compact one,
    // so anything past the caps plus wrapping slack is rejected before the
    // validating scan or the compaction copy. Only whitespace-heavy monsters
    // past the slack (never legitimate wrapping) take this exit.
    if (
      data.length > MAX_MCP_ATTACHMENT_BASE64 + MAX_MCP_BASE64_SLACK ||
      totalBase64 + data.length > MAX_MCP_ATTACHMENTS_TOTAL_BASE64 + MAX_MCP_BASE64_SLACK
    ) {
      pushText("[MCP attachment dropped: exceeds the attachment size limit]")
      return "dropped"
    }
    // Invalid base64 would persist a broken data URL into session history
    // and poison every later provider request, so validate before storing.
    // Measure first without copying: a hostile oversized payload is rejected
    // before the whitespace compaction allocates anything.
    const measured = measureBase64(data)
    if (!measured) return dropScanned(data.length, "[MCP attachment dropped: invalid base64 content]")
    if (
      measured.length > MAX_MCP_ATTACHMENT_BASE64 ||
      totalBase64 + measured.length > MAX_MCP_ATTACHMENTS_TOTAL_BASE64
    ) {
      return dropScanned(data.length, "[MCP attachment dropped: exceeds the attachment size limit]")
    }
    if (imageKind !== undefined && !mcpImageMagicOkRaw(imageKind, data)) {
      return dropScanned(data.length, `[MCP attachment dropped: image content does not match ${mime}]`)
    }
    const compact = measured.hasWhitespace ? data.replace(/\s/g, "") : data
    totalBase64 += compact.length
    attachments.push({
      type: "file",
      mime,
      url: `data:${mime};base64,${compact}`,
      ...(filename !== undefined ? { filename: filename.slice(0, MAX_MCP_FILENAME) } : {}),
    })
    return "stored"
  }

  for (const contentItem of content) {
    // Four stop conditions keep a hostile flood at O(capped) cost instead of
    // O(n): exhausted budgets (later pushes are no-ops), rejected-scan bytes
    // (returned as "stop"), scan-costly idle items that keep neither text
    // nor bytes, and O(1) skipped items (unsupported types, empty text).
    if (textCapped && (attachments.length >= MAX_MCP_ATTACHMENTS || totalBase64 >= MAX_MCP_ATTACHMENTS_TOTAL_BASE64))
      break
    const keptTexts = textParts.length
    const keptAttachments = attachments.length
    let stop = false
    if (contentItem.type === "text" && typeof contentItem.text === "string" && contentItem.text) {
      pushText(contentItem.text)
    } else if (contentItem.type === "image" && typeof contentItem.data === "string" && contentItem.data) {
      // Image attachments must stay inside the provider-supported set with
      // matching magic bytes: anything else would flow to renderers or
      // providers as an image part and poison every later request.
      const mimeType = validMcpMimeType(contentItem.mimeType, "image/png").toLowerCase()
      const kind = MCP_IMAGE_TYPES[mimeType]
      if (!kind) {
        pushText(`[MCP attachment dropped: unsupported image mime type ${mimeType}]`)
      } else {
        const outcome = pushAttachment(mimeType, contentItem.data, undefined, kind)
        // Label only what survived: announcing first would record a phantom
        // attachment when the drop reason itself hits the text cap.
        if (outcome === "stored") pushText(`[Image content: ${mimeType}]`)
        stop = outcome === "stop"
      }
    } else if (contentItem.type === "resource" && isRecord(contentItem.resource)) {
      const resource = contentItem.resource as McpToolContentItem["resource"] & Record<string, unknown>
      // A resource with neither text nor blob keeps nothing by construction;
      // routing it through idle would let 1024 uri-only resources silently
      // drop a trailing real summary while the budget is still open.
      if (
        !(typeof resource.text === "string" && resource.text) &&
        !(typeof resource.blob === "string" && resource.blob)
      ) {
        if (skipItem()) break
        continue
      }
      if (typeof resource.text === "string" && resource.text) pushText(resource.text)
      const uri = typeof resource.uri === "string" ? resource.uri.slice(0, MAX_MCP_FILENAME) : undefined
      if (typeof resource.blob === "string" && resource.blob) {
        // MIME types are case-insensitive; normalize before the image gate so
        // IMAGE/PNG cannot slip past the allowlist the image branch enforces.
        // Non-image MIME passes through deliberately: tool-output media with
        // an unknown type is dropped with a warning (Anthropic) or flattened
        // to inert JSON text (OpenAI-compatible), so it cannot poison later
        // requests — while image-data carries media_type straight to the API
        // and stays allowlisted above.
        const mimeType = validMcpMimeType(resource.mimeType, "application/octet-stream").toLowerCase()
        const imageKind = mimeType.startsWith("image/") ? MCP_IMAGE_TYPES[mimeType] : undefined
        if (mimeType.startsWith("image/") && !imageKind) {
          pushText(`[MCP attachment dropped: unsupported image mime type ${mimeType}]`)
        } else {
          const outcome = pushAttachment(mimeType, resource.blob, uri, imageKind)
          if (outcome === "stored") pushText(`[Binary MCP resource: ${uri ?? "unknown"} (${mimeType})]`)
          stop = outcome === "stop"
        }
      }
    } else {
      // Benign-but-unsupported content (resource_link, audio, empty text):
      // O(1) to skip with no scan cost, so it must not consume the
      // rejected-idle budget — otherwise a long benign list drops a
      // trailing real summary and misreports a rejection flood.
      if (skipItem()) break
      continue
    }
    if (stop) break
    if (textParts.length === keptTexts && attachments.length === keptAttachments) {
      // Every branch that reaches here pushed a marker, label, or payload
      // (content-less inputs skip earlier via skipItem), so keeping nothing
      // means the text budget is already capped: a marker push would be a
      // no-op. Break silently instead; the truncation notice already
      // explains the cut, and a rejection-flood marker here would mislead.
      idleItems++
      if (idleItems >= MAX_MCP_IDLE_ITEMS) break
    } else {
      idleItems = 0
    }
  }

  return { textParts, attachments }
}

const MCP_TEXT_TRUNCATED = `[Untrusted MCP content truncated at ${MAX_MCP_TEXT_BYTES} bytes]`
const MCP_TEXT_TRUNCATED_NOTICE = `\n\n${MCP_TEXT_TRUNCATED}`
const MCP_TEXT_TRUNCATED_NOTICE_BYTES = Buffer.byteLength(MCP_TEXT_TRUNCATED_NOTICE, "utf8")

/**
 * Hard cap for untrusted MCP text before the truncation preview. The full
 * text is also written to disk for later inspection, so an unbounded result
 * would exhaust the truncation directory regardless of the preview size.
 * Collection already budgets, this is the second layer for direct callers
 * (structuredContent fallback); it pre-slices so the encode buffer stays
 * bounded instead of copying a hostile multi-hundred-megabyte string. The
 * notice bytes reserve inside the cap, so output never exceeds the budget
 * and exactly one notice survives nested truncation: an inner complete
 * notice peels first (only small enough to be one), and anything shorter
 * than a full notice falls past the reserved cut on its own.
 */
export function boundMcpResultText(text: string): string {
  const total = Buffer.byteLength(text, "utf8")
  if (total <= MAX_MCP_TEXT_BYTES) return text
  const body =
    total <= MAX_MCP_TEXT_BYTES + MCP_TEXT_TRUNCATED_NOTICE_BYTES + 128 && text.endsWith(MCP_TEXT_TRUNCATED_NOTICE)
      ? text.slice(0, text.length - MCP_TEXT_TRUNCATED_NOTICE.length)
      : text
  return `${truncateUtf8Bytes(body, MAX_MCP_TEXT_BYTES - MCP_TEXT_TRUNCATED_NOTICE_BYTES)}${MCP_TEXT_TRUNCATED_NOTICE}`
}

/**
 * Server-provided result metadata, guarded: only a plain record passes
 * through, and only while small. A hostile string, array, circular, or
 * multi-megabyte metadata degrades to {} instead of exploding into the
 * persisted part metadata. The MCP transport schema already strips unknown
 * result keys; this is the second layer for direct and mocked dispatches.
 */
export function mcpResultMetadata(result: unknown): Record<string, unknown> {
  try {
    if (!isRecord(result) || !isRecord(result.metadata)) return {}
    // One budgeted serialization gates the copy: oversized, circular, or
    // bigint-bearing metadata degrades to {} before any full-size string or
    // key array exists. toJSON never runs, so caller code cannot smuggle
    // output past the estimate, and exotic objects serialize deterministically.
    const preview = boundedJsonStringify(result.metadata, MAX_MCP_SERVER_METADATA_BYTES)
    if (!preview || preview.truncated) return {}
    // Return the round-tripped copy, never the caller's object: no aliasing
    // with the transport result, and the in-memory shape already equals what
    // JSON session storage will persist.
    const roundTripped = parseJsonResult(preview.text)
    if (!roundTripped.ok || !isRecord(roundTripped.value)) return {}
    return roundTripped.value
  } catch {
    // Revoked proxies and throwing getters degrade to {}, matching the
    // old JSON.stringify-in-try/catch contract for direct inputs.
    return {}
  }
}

/**
 * Part metadata for an MCP tool result. Server metadata lives under its own
 * `mcpServer` namespace so it can never smuggle trusted keys (outputPath,
 * truncated, ...) into the persisted part; trusted keys are always written
 * unconditionally, matching the registry tool path.
 */
export function mcpResultPartMetadata(
  result: unknown,
  truncated: {
    truncated: boolean
    outputPath?: string
    fullOutputPath?: string
    originalSize?: number
    truncatedTo?: number
    contentHint?: string
  },
): Record<string, unknown> {
  const server = mcpResultMetadata(result)
  return {
    ...(Object.keys(server).length > 0 ? { mcpServer: server } : {}),
    truncated: truncated.truncated,
    outputPath: truncated.truncated ? truncated.outputPath : undefined,
    fullOutputPath: truncated.truncated ? truncated.fullOutputPath : undefined,
    originalSize: truncated.truncated ? truncated.originalSize : undefined,
    truncatedTo: truncated.truncated ? truncated.truncatedTo : undefined,
    contentHint: truncated.truncated ? truncated.contentHint : undefined,
  }
}

const JSON_ESCAPES: Record<number, string> = {
  8: "\\b",
  9: "\\t",
  10: "\\n",
  12: "\\f",
  13: "\\r",
  34: '\\"',
  92: "\\\\",
}

// Every object key visited (own, inherited, or skipped) counts toward this
// cap; past it the value aborts as truncated. Emitted keys would trip the
// byte budget first in any realistic shape (each costs several bytes), so
// the cap only bites floods of skipped or inherited keys. Array indices
// need no cap: every index emits at least one byte.
const MAX_MCP_JSON_KEYS = 1_000_000

export type BoundedJsonResult = { text: string; truncated: boolean }

/**
 * Compact JSON writer with a byte budget. Emits JSON.stringify-compatible
 * output for plain data while aborting past the budget, so a hostile
 * multi-hundred-megabyte structuredContent value never materializes as a
 * full string. Iterative (no call-stack depth risk), holds no retained key
 * or index array (array frames keep length plus position; object keys stream
 * through one generator), never invokes toJSON, and returns undefined for
 * circular, bigint-bearing, or getter/proxy-throwing values exactly like the
 * JSON.stringify path it replaces. Residual: V8 materializes one transient
 * key list when a hostile object's enumeration starts (verified: same cost
 * as Object.keys, freed after); the transport's own JSON parse already paid
 * that class of cost for network input, and direct callers are in-process.
 */
export function boundedJsonStringify(value: unknown, maxBytes: number): BoundedJsonResult | undefined {
  type Frame =
    | { kind: "array"; container: unknown[]; index: number }
    | { kind: "object"; container: Record<string, unknown>; enumerator: Generator<string>; emitted: number }
  const parts: string[] = []
  let bytes = 0
  let aborted = false
  let enumerated = 0
  const active = new Set<unknown>()
  // Streams every for-in key (own and inherited) without retaining them; the
  // walk filters by hasOwn and counts every visit toward the key cap.
  function* allKeys(node: Record<string, unknown>): Generator<string> {
    for (const key in node) yield key
  }
  const abort = (): false => {
    aborted = true
    return false
  }
  // Appends `text` while the budget holds; returns false once it ends.
  const emit = (text: string): boolean => {
    if (aborted) return false
    const size = Buffer.byteLength(text, "utf8")
    if (bytes + size > maxBytes) return abort()
    parts.push(text)
    bytes += size
    return true
  }
  const emitString = (text: string): boolean => {
    // Escape in small chunks: one giant control-char string must not expand
    // to a 6x copy before the budget check sees it.
    if (!emit('"')) return false
    for (let offset = 0; offset < text.length; ) {
      // Keep surrogate pairs inside one chunk: split halves byte-count as 3
      // bytes each while the joined pair costs 4, which would overcharge the
      // budget by 2 bytes per split pair.
      let end = Math.min(offset + 1024, text.length)
      if (
        end < text.length &&
        text.charCodeAt(end - 1) >= 0xd800 &&
        text.charCodeAt(end - 1) <= 0xdbff &&
        text.charCodeAt(end) >= 0xdc00 &&
        text.charCodeAt(end) <= 0xdfff
      ) {
        end++
      }
      const chunk = text.slice(offset, end)
      const start = offset
      offset = end
      let escaped = ""
      for (let index = 0; index < chunk.length; index++) {
        const code = chunk.charCodeAt(index)
        const named = JSON_ESCAPES[code]
        if (named !== undefined) escaped += named
        else if (code < 0x20) escaped += `\\u${code.toString(16).padStart(4, "0")}`
        else if (code >= 0xd800 && code <= 0xdfff) {
          // Paired surrogates pass through raw; unpaired ones escape, exactly
          // like JSON.stringify. Lookahead/behind run on the full text so a
          // pair split across chunks still matches.
          const position = start + index
          const paired =
            code <= 0xdbff
              ? text.charCodeAt(position + 1) >= 0xdc00 && text.charCodeAt(position + 1) <= 0xdfff
              : position > 0 && text.charCodeAt(position - 1) >= 0xd800 && text.charCodeAt(position - 1) <= 0xdbff
          escaped += paired ? chunk[index] : `\\u${code.toString(16).padStart(4, "0")}`
        } else escaped += chunk[index]
      }
      if (!emit(escaped)) {
        // Best effort: close the string even past the budget (one byte over).
        // Truncated output is display text; the caller appends its own
        // truncation notice and re-caps the total.
        parts.push('"')
        bytes += 1
        return false
      }
    }
    return emit('"')
  }
  const emitScalar = (node: unknown): boolean | undefined => {
    if (node === null) return emit("null")
    switch (typeof node) {
      case "string":
        return emitString(node)
      case "number":
        return emit(Number.isFinite(node) ? String(node) : "null")
      case "boolean":
        return emit(node ? "true" : "false")
      case "bigint":
        return undefined
      default:
        return true
    }
  }
  const stack: Frame[] = []
  // Pushes a value: true keeps walking, false aborts on budget, undefined
  // rejects the whole value (circular reference or bigint, like stringify).
  const pushValue = (node: unknown): boolean | undefined => {
    if (node === null || typeof node !== "object") return emitScalar(node)
    if (node instanceof Date) return Number.isNaN(node.getTime()) ? emit("null") : emitString(node.toISOString())
    if (active.has(node)) return undefined
    // A depth overrun aborts as truncated instead of emitting a
    // placeholder: callers treat truncated:false as a complete copy, so a
    // silent substitution would persist mutated data as intact metadata and
    // hide a lost structuredContent subtree from the truncation notice.
    if (active.size >= MAX_MCP_JSON_DEPTH) return abort()
    active.add(node)
    if (Array.isArray(node)) {
      stack.push({ kind: "array", container: node, index: 0 })
      return emit("[")
    }
    stack.push({
      kind: "object",
      container: node as Record<string, unknown>,
      enumerator: allKeys(node as Record<string, unknown>),
      emitted: 0,
    })
    return emit("{")
  }
  // Emits one child value; shares pushValue's true/false/undefined contract.
  const pushChild = (child: unknown, inArray: boolean): boolean | undefined => {
    if (child === null || typeof child !== "object") {
      if (child === undefined || typeof child === "function" || typeof child === "symbol") {
        return inArray ? emit("null") : true
      }
      return emitScalar(child)
    }
    return pushValue(child)
  }
  // Throwing getters and revoked proxies degrade to undefined, matching the
  // old JSON.stringify-in-try/catch contract for direct and mocked inputs.
  try {
    const seed = pushValue(value)
    if (seed === undefined) return undefined
    if (seed === false) return { text: parts.join(""), truncated: true }
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (!frame) break
      if (frame.kind === "array") {
        if (frame.index >= frame.container.length) {
          stack.pop()
          active.delete(frame.container)
          if (!emit("]")) break
          continue
        }
        if (frame.index > 0 && !emit(",")) break
        const child = frame.container[frame.index]
        frame.index++
        const done = pushChild(child, true)
        if (done === undefined) return undefined
        if (!done) break
        continue
      }
      const next = frame.enumerator.next()
      if (next.done) {
        stack.pop()
        active.delete(frame.container)
        if (!emit("}")) break
        continue
      }
      enumerated++
      if (enumerated > MAX_MCP_JSON_KEYS) {
        abort()
        break
      }
      if (!Object.hasOwn(frame.container, next.value)) continue
      const child = frame.container[next.value]
      if (child === undefined || typeof child === "function" || typeof child === "symbol") continue
      if (frame.emitted > 0 && !emit(",")) break
      frame.emitted++
      if (!emitString(next.value) || !emit(":")) break
      const done = pushChild(child, false)
      if (done === undefined) return undefined
      if (!done) break
    }
  } catch {
    return undefined
  }
  // No closers or notice here: truncated output stays a raw budgeted prefix
  // (at most one byte over for a mid-string cut), and the caller reports the
  // cut exactly once through its own notice and truncated flag.
  const text = parts.join("")
  if (text === "" && !aborted) return undefined
  return { text, truncated: aborted }
}

function formatMcpStructuredContent(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === "string") {
    // Bound before trimming: trim copies the kept range, so trimming a
    // hostile half-gigabyte body first would materialize it before the cap.
    // Small strings keep exact trim-then-use semantics.
    if (Buffer.byteLength(value, "utf8") <= MAX_MCP_TEXT_BYTES) {
      const trimmed = value.trim()
      return trimmed ? trimmed : undefined
    }
    return boundMcpResultText(value).trim()
  }
  const json = boundedJsonStringify(value, MAX_MCP_TEXT_BYTES)
  if (!json || json.text === "{}" || json.text === "[]") return undefined
  // The serializer reports the cut through its flag; note it here so the
  // fallback text carries the same signal as truncated text parts. The
  // caller's bound re-caps the total and keeps a single visible notice.
  if (!json.truncated) return json.text
  return `${json.text}${MCP_TEXT_TRUNCATED_NOTICE}`
}

function mcpContentUsable(collected: { textParts: string[]; attachments: unknown[] }): boolean {
  return collected.textParts.some((part) => part.trim().length > 0) || collected.attachments.length > 0
}

/** Prefer MCP `content`. Use `structuredContent` only when content is empty — never both. */
export function collectMcpToolResult(result: unknown) {
  const record = isRecord(result) ? result : {}
  const content = Array.isArray(record.content) ? (record.content as McpToolContentItem[]) : []
  const collected = collectMcpToolContent(content)
  if (mcpContentUsable(collected)) return collected
  const structured = formatMcpStructuredContent(record.structuredContent)
  return {
    textParts: structured ? [boundMcpResultText(structured)] : [],
    attachments: collected.attachments,
  }
}
