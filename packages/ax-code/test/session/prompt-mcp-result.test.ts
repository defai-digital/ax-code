import { describe, expect, test } from "vitest"
import {
  boundMcpHookFeedback,
  boundMcpResultText,
  boundedJsonStringify,
  collectMcpToolContent,
  collectMcpToolResult,
  formatHookFeedback,
  mcpResultMetadata,
  mcpResultPartMetadata,
} from "../../src/session/prompt/prompt-tools"

// "TWFu" decodes to "Man": length stays a multiple of 4 for any repeat count.
const validBase64 = (bytes: number) => "TWFu".repeat(Math.ceil(bytes / 4))
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff, 0xe0])
const pngB64 = (payload: string | Buffer) => Buffer.concat([PNG_MAGIC, Buffer.from(payload)]).toString("base64")
const jpegB64 = (payload: string | Buffer) => Buffer.concat([JPEG_MAGIC, Buffer.from(payload)]).toString("base64")
// Decoded length for an exact base64 length: raw bytes = chars * 3 / 4.
const pngB64Sized = (chars: number) => pngB64(Buffer.alloc((chars * 3) / 4 - PNG_MAGIC.length, 0x78))

describe("untrusted MCP result bounds", () => {
  test("oversized attachments degrade to placeholders", () => {
    const big = pngB64Sized(9 * 1024 * 1024)
    const { textParts, attachments } = collectMcpToolContent([
      { type: "image", data: big, mimeType: "image/png" },
      { type: "image", data: pngB64("small"), mimeType: "image/png" },
    ])
    expect(attachments).toHaveLength(1)
    expect(attachments[0]).toMatchObject({ mime: "image/png" })
    expect(textParts.join("\n")).toContain("exceeds the attachment size limit")
  })

  test("whitespace-laced oversized payloads are rejected without materializing", () => {
    const compact = pngB64Sized(9 * 1024 * 1024)
    const laced = compact.replace(/.{76}/g, "$&\n")
    const { textParts, attachments } = collectMcpToolContent([{ type: "image", data: laced, mimeType: "image/png" }])
    expect(attachments).toEqual([])
    expect(textParts.join("\n")).toContain("exceeds the attachment size limit")
  })

  test("near-cap pretty-printed payloads survive the raw pre-gate slack", () => {
    const compact = pngB64Sized(8 * 1024 * 1024)
    const wrapped = compact.replace(/.{76}/g, "$&\r\n")
    expect(wrapped.length).toBeGreaterThan(8 * 1024 * 1024)
    const { attachments } = collectMcpToolContent([{ type: "image", data: wrapped, mimeType: "image/png" }])
    expect(attachments).toHaveLength(1)
    expect(attachments[0].url).toBe(`data:image/png;base64,${compact}`)
  })

  test("rejected-scan bytes stop a mismatch flood", () => {
    const mismatch = validBase64(8 * 1024 * 1024)
    const flood = Array.from({ length: 9 }, () => ({ type: "image", data: mismatch, mimeType: "image/png" }))
    const { textParts, attachments } = collectMcpToolContent(flood as never)
    expect(attachments).toEqual([])
    expect(textParts.join("\n")).toContain("too much rejected content")
  })

  test("idle items stop the walk instead of spinning forever", () => {
    // Once the text budget is capped, every rejected image pays for
    // validation yet keeps nothing; the walk breaks silently (a marker
    // push would be a no-op past the cap), dropping even a trailing
    // valid attachment that would otherwise be stored.
    const cap = { type: "text", text: "x".repeat(8 * 1024 * 1024) }
    const rejects = Array.from({ length: 2000 }, () => ({ type: "image", data: "!!!", mimeType: "image/png" }))
    const trailing = { type: "image", data: pngB64("late"), mimeType: "image/png" }
    const { textParts, attachments } = collectMcpToolContent([cap, ...rejects, trailing] as never)
    expect(attachments).toEqual([])
    expect(textParts.join("\n")).toContain("truncated at")
    expect(textParts.join("\n")).not.toContain("too much rejected content")
  })

  test("benign unsupported types never consume the idle budget", () => {
    const links = Array.from({ length: 1500 }, (_, index) => ({ type: "resource_link", uri: `file:///doc/${index}` }))
    const { textParts, attachments } = collectMcpToolContent([
      ...links,
      { type: "audio", data: "AAAA", mimeType: "audio/mpeg" },
      { type: "text", text: "" },
      { type: "text", text: "kept summary" },
    ] as never)
    expect(attachments).toEqual([])
    expect(textParts).toEqual(["kept summary"])
  })

  test("content-less resources skip instead of consuming the idle budget", () => {
    const bare = Array.from({ length: 1500 }, (_, index) => ({
      type: "resource",
      resource: { uri: `file:///bare/${index}` },
    }))
    const { textParts, attachments } = collectMcpToolContent([
      ...bare,
      { type: "resource", resource: { text: "", blob: "" } },
      { type: "text", text: "kept summary" },
    ] as never)
    expect(attachments).toEqual([])
    expect(textParts).toEqual(["kept summary"])
  })

  test("a skipped-item flood still stops the walk", () => {
    const flood = Array.from({ length: 100_001 }, () => ({ type: "resource_link" }))
    const { textParts } = collectMcpToolContent([...flood, { type: "text", text: "lost" }] as never)
    expect(textParts.join("\n")).toContain("too many unsupported items")
    expect(textParts.join("\n")).not.toContain("lost")
  })

  test("skipped-only content still falls back to structuredContent", () => {
    const { textParts } = collectMcpToolResult({
      content: [{ type: "resource_link" }, { type: "text", text: "" }],
      structuredContent: { ok: true },
    })
    expect(textParts).toEqual(['{"ok":true}'])
  })

  test("attachment count and total size stay bounded", () => {
    const many = Array.from({ length: 12 }, () => ({ type: "image", data: pngB64("small"), mimeType: "image/png" }))
    const counted = collectMcpToolContent(many as never)
    expect(counted.attachments).toHaveLength(10)
    expect(counted.textParts.join("\n")).toContain("too many attachments")
    // Pin the total at exactly 16 MiB: 8 + 8 fits, one more byte does not.
    const eight = pngB64Sized(8 * 1024 * 1024)
    expect(eight).toHaveLength(8 * 1024 * 1024)
    const totaled = collectMcpToolContent([
      { type: "image", data: eight, mimeType: "image/png" },
      { type: "image", data: eight, mimeType: "image/png" },
      { type: "image", data: pngB64("one more"), mimeType: "image/png" },
    ])
    expect(totaled.attachments).toHaveLength(2)
    const kept = totaled.attachments.map((attachment) => attachment.url.split(",")[1].length)
    expect(kept).toEqual([8 * 1024 * 1024, 8 * 1024 * 1024])
    expect(totaled.textParts.join("\n")).toContain("exceeds the attachment size limit")
  })

  test("mime types and filenames are validated before persistence", () => {
    const { attachments, textParts } = collectMcpToolContent([
      { type: "image", data: pngB64("small"), mimeType: "text/html;base64,evil" },
      { type: "resource", resource: { blob: validBase64(8), mimeType: "not a mime", uri: "u".repeat(5000) } },
    ])
    expect(attachments).toHaveLength(2)
    expect(attachments[0].mime).toBe("image/png")
    expect(attachments[1].mime).toBe("application/octet-stream")
    expect(attachments[1].filename).toHaveLength(1024)
    expect(textParts.join("\n")).not.toContain(";base64,evil")
    // The persisted URL uses the fallback type, never the hostile original.
    expect(attachments[0].url.startsWith("data:image/png;base64,")).toBe(true)
    expect(attachments[0].url).not.toContain("text/html")
  })

  test("images outside the provider-supported set are dropped", () => {
    const { attachments, textParts } = collectMcpToolContent([
      { type: "image", data: validBase64(32), mimeType: "text/html" },
      { type: "image", data: validBase64(32), mimeType: "image/svg+xml" },
      { type: "image", data: validBase64(32), mimeType: "image/tiff" },
      { type: "image", data: jpegB64("small"), mimeType: "image/jpeg" },
    ])
    expect(attachments).toHaveLength(1)
    expect(attachments[0].mime).toBe("image/jpeg")
    expect(textParts.join("\n")).toContain("unsupported image mime type text/html")
    expect(textParts.join("\n")).toContain("unsupported image mime type image/svg+xml")
  })

  test("image content must match the declared magic bytes", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64")
    const { attachments, textParts } = collectMcpToolContent([
      { type: "image", data: html, mimeType: "image/png" },
      { type: "image", data: validBase64(32), mimeType: "image/png" },
      { type: "image", data: pngB64("small"), mimeType: "image/png" },
    ])
    expect(attachments).toHaveLength(1)
    expect(textParts.join("\n")).toContain("does not match image/png")
  })

  test("inclusion labels appear only for stored attachments", () => {
    const html = Buffer.from("<html>nope</html>").toString("base64")
    const dropped = collectMcpToolContent([{ type: "image", data: html, mimeType: "image/png" }])
    expect(dropped.attachments).toEqual([])
    expect(dropped.textParts).toEqual(["[MCP attachment dropped: image content does not match image/png]"])
    const stored = collectMcpToolContent([{ type: "image", data: pngB64("small"), mimeType: "image/png" }])
    expect(stored.attachments).toHaveLength(1)
    expect(stored.textParts).toEqual(["[Image content: image/png]"])
    const resource = collectMcpToolContent([
      { type: "resource", resource: { blob: html, mimeType: "image/png", uri: "r1" } },
    ])
    expect(resource.attachments).toEqual([])
    expect(resource.textParts).toEqual(["[MCP attachment dropped: image content does not match image/png]"])
  })

  test("resource blobs cannot bypass the image gate", () => {
    const html = Buffer.from("<html><script>alert(1)</script></html>").toString("base64")
    const { attachments, textParts } = collectMcpToolContent([
      { type: "resource", resource: { blob: html, mimeType: "image/png", uri: "r1" } },
      { type: "resource", resource: { blob: validBase64(32), mimeType: "image/svg+xml", uri: "r2" } },
      { type: "resource", resource: { blob: pngB64("small"), mimeType: "IMAGE/PNG", uri: "r3" } },
      { type: "resource", resource: { blob: validBase64(32), mimeType: "application/pdf", uri: "r4" } },
    ])
    expect(attachments).toHaveLength(2)
    expect(attachments[0]).toMatchObject({ mime: "image/png", filename: "r3" })
    expect(attachments[1]).toMatchObject({ mime: "application/pdf", filename: "r4" })
    expect(textParts.join("\n")).toContain("does not match image/png")
    expect(textParts.join("\n")).toContain("unsupported image mime type image/svg+xml")
  })

  test("invalid base64 is dropped instead of persisting a broken data URL", () => {
    const { attachments, textParts } = collectMcpToolContent([
      { type: "image", data: "!!!not-base64,<html>", mimeType: "image/png" },
      { type: "image", data: "abc", mimeType: "image/png" },
      { type: "image", data: pngB64("small"), mimeType: "image/png" },
    ])
    expect(attachments).toHaveLength(1)
    expect(textParts.join("\n")).toContain("invalid base64 content")
    expect(attachments[0].url).toMatch(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)
  })

  test("base64 padding placement is enforced", () => {
    // Resource blobs skip the image magic gate, isolating padding validity.
    const blob = (data: string) =>
      collectMcpToolContent([{ type: "resource", resource: { blob: data, uri: "u" } }]).attachments.length
    expect(blob("ABC=")).toBe(1)
    expect(blob("AB==")).toBe(1)
    expect(blob("AB=C")).toBe(0)
    expect(blob("=ABC")).toBe(0)
    expect(blob("A===")).toBe(0)
    expect(blob("   ")).toBe(0)
  })

  test("whitespace-padded base64 is compacted before storage", () => {
    const padded = `${pngB64("small").slice(0, 8)}\n${pngB64("small").slice(8, 16)}\r\n${pngB64("small").slice(16)}`
    const { attachments } = collectMcpToolContent([{ type: "image", data: padded, mimeType: "image/png" }])
    expect(attachments).toHaveLength(1)
    expect(attachments[0].url).toBe(`data:image/png;base64,${pngB64("small")}`)
  })

  test("non-string content fields are ignored instead of persisted", () => {
    const { textParts, attachments } = collectMcpToolContent([
      { type: "text", text: { nested: true } },
      { type: "image", data: 42 },
      { type: "resource", resource: { text: ["array"], blob: 7, uri: { odd: 1 } } },
    ] as never)
    expect(textParts).toEqual([])
    expect(attachments).toEqual([])
    expect(collectMcpToolResult({ content: [{ type: "text", text: 7 }], structuredContent: { a: 1 } })).toMatchObject({
      textParts: ['{"a":1}'],
    })
  })

  test("the text budget truncates while collecting, not after joining", () => {
    const part = "x".repeat(5 * 1024 * 1024)
    const { textParts } = collectMcpToolContent([
      { type: "text", text: part },
      { type: "text", text: part },
      { type: "text", text: "never collected" },
    ])
    const joined = textParts.join("\n\n")
    expect(joined).toContain("truncated at 8388608 bytes")
    expect(joined).not.toContain("never collected")
    expect(Buffer.byteLength(joined, "utf8")).toBeLessThan(8 * 1024 * 1024 + 1024)
  })

  test("placeholder floods stay inside the same text budget", () => {
    const flood = Array.from({ length: 200_000 }, () => ({ type: "image", data: "!!!", mimeType: "image/png" }))
    const { textParts, attachments } = collectMcpToolContent(flood as never)
    expect(attachments).toEqual([])
    const joined = textParts.join("\n\n")
    expect(joined).toContain("truncated at 8388608 bytes")
    expect(Buffer.byteLength(joined, "utf8")).toBeLessThan(8 * 1024 * 1024 + 4096)
  })

  test("untrusted text is hard-capped before the truncation preview", () => {
    expect(boundMcpResultText("small")).toBe("small")
    const input = "x".repeat(9 * 1024 * 1024)
    const capped = boundMcpResultText(input)
    const notice = "\n\n[Untrusted MCP content truncated at 8388608 bytes]"
    expect(capped).toContain("truncated at 8388608 bytes")
    expect(capped.endsWith(notice)).toBe(true)
    // The notice bytes reserve inside the cap: content shrinks, total is exact.
    expect(capped.slice(0, 8 * 1024 * 1024 - notice.length)).toBe(input.slice(0, 8 * 1024 * 1024 - notice.length))
    expect(Buffer.byteLength(capped, "utf8")).toBe(8 * 1024 * 1024)
  })

  test("byte truncation keeps a clean multibyte prefix", () => {
    // U+20AC is 3 bytes in UTF-8, so the 8 MiB budget splits a character and
    // the cut must backtrack to a boundary instead of emitting U+FFFD.
    const input = "€".repeat(5 * 1024 * 1024)
    const capped = boundMcpResultText(input)
    expect(capped).toContain("truncated at 8388608 bytes")
    expect(capped.slice(0, 100)).toBe(input.slice(0, 100))
    const body = capped.split("\n\n[Untrusted MCP content")[0]
    expect(body).toMatch(/^€+$/)
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(8 * 1024 * 1024)
  })

  test("byte truncation backtracks out of a split four-byte character", () => {
    // "abcde" shifts the reserved cut three bytes into an emoji; the fragment drops.
    const input = `abcde${"😀".repeat(3 * 1024 * 1024)}`
    const capped = boundMcpResultText(input)
    const body = capped.split("\n\n[Untrusted MCP content")[0]
    expect(body).toBe(`abcde${"😀".repeat(2097137)}`)
    expect(body).not.toContain("\uFFFD")
    expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(8388608)
  })

  test("hook feedback keeps its own budget past hostile output", () => {
    const feedback = "policy: deny all writes"
    expect(boundMcpHookFeedback(feedback)).toBe(formatHookFeedback(feedback))
    const huge = boundMcpHookFeedback("f".repeat(100 * 1024))
    expect(huge).toContain("hook feedback truncated at 65536 bytes")
    expect(huge).toContain('<hook_feedback event="PostToolUse">')
    expect(Buffer.byteLength(huge, "utf8")).toBeLessThanOrEqual(64 * 1024)
  })

  test("oversized structuredContent falls back bounded", () => {
    const { textParts } = collectMcpToolResult({ structuredContent: { blob: "y".repeat(9 * 1024 * 1024) } })
    expect(textParts).toHaveLength(1)
    expect(textParts[0]).toContain("truncated at 8388608 bytes")
    expect(Buffer.byteLength(textParts[0], "utf8")).toBeLessThan(9 * 1024 * 1024)
  })

  test("nested truncation keeps exactly one notice, never a fragment", () => {
    // Inner notice lands inside the outer cut: the fragment strips and one
    // full notice remains.
    const inner = `{"blob":"${"y".repeat(8 * 1024 * 1024)}"}\n\n[Untrusted MCP content truncated at 8388608 bytes]`
    const capped = boundMcpResultText(inner)
    expect(capped.match(/Untrusted MCP content/g)).toHaveLength(1)
    expect(capped.endsWith("\n\n[Untrusted MCP content truncated at 8388608 bytes]")).toBe(true)
    expect(Buffer.byteLength(capped, "utf8")).toBeLessThanOrEqual(8388608)
    const { textParts } = collectMcpToolResult({ structuredContent: { blob: "y".repeat(9 * 1024 * 1024) } })
    expect(textParts[0].match(/Untrusted MCP content/g)).toHaveLength(1)
    expect(Buffer.byteLength(textParts[0], "utf8")).toBeLessThanOrEqual(8388608)
  })

  test("string structuredContent bounds before trimming", () => {
    expect(collectMcpToolResult({ structuredContent: "  hi  " })).toMatchObject({ textParts: ["hi"] })
    expect(collectMcpToolResult({ structuredContent: "   " })).toMatchObject({ textParts: [] })
    const { textParts } = collectMcpToolResult({ structuredContent: ` ${"A".repeat(9 * 1024 * 1024)} ` })
    expect(textParts).toHaveLength(1)
    expect(textParts[0].startsWith("A")).toBe(true)
    expect(textParts[0]).toContain("truncated at 8388608 bytes")
    expect(Buffer.byteLength(textParts[0], "utf8")).toBeLessThan(9 * 1024 * 1024)
  })

  test("only small record metadata passes through to the persisted part", () => {
    expect(mcpResultMetadata({ metadata: { ok: true } })).toEqual({ ok: true })
    expect(mcpResultMetadata({ metadata: "explodes" })).toEqual({})
    expect(mcpResultMetadata({ metadata: ["array"] })).toEqual({})
    expect(mcpResultMetadata({ metadata: { blob: "z".repeat(64 * 1024) } })).toEqual({})
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(mcpResultMetadata({ metadata: circular })).toEqual({})
    expect(mcpResultMetadata({})).toEqual({})
    expect(mcpResultMetadata(undefined)).toEqual({})
  })

  test("returned metadata is a copy detached from the transport result", () => {
    const source = { metadata: { nested: { count: 1 } } }
    const copied = mcpResultMetadata(source)
    expect(copied).toEqual({ nested: { count: 1 } })
    source.metadata.nested.count = 999
    expect(copied).toEqual({ nested: { count: 1 } })
  })

  test("exotic metadata values degrade safely without running caller code", () => {
    expect(mcpResultMetadata({ metadata: { when: new Date("2024-01-02T03:04:05.678Z") } })).toEqual({
      when: "2024-01-02T03:04:05.678Z",
    })
    const throwing = {
      metadata: {
        nested: {
          toJSON: () => {
            throw new Error("must not run")
          },
        },
      },
    }
    expect(mcpResultMetadata(throwing)).toEqual({ nested: {} })
    expect(mcpResultMetadata({ metadata: { n: 10n } })).toEqual({})
    expect(mcpResultMetadata({ metadata: { bytes: new Uint8Array(1024 * 1024) } })).toEqual({})
    // Small exotic values serialize deterministically; only oversized ones degrade.
    expect(Object.keys(mcpResultMetadata({ metadata: new Uint8Array(64) as never }))).toHaveLength(64)
  })

  test("server metadata is namespaced and cannot smuggle trusted keys", () => {
    const untruncated = mcpResultPartMetadata(
      { metadata: { outputPath: "/etc/shadow", truncated: true, note: "hi" } },
      { truncated: false },
    )
    expect(untruncated.truncated).toBe(false)
    expect(untruncated.outputPath).toBeUndefined()
    expect(untruncated).toMatchObject({ mcpServer: { outputPath: "/etc/shadow", note: "hi" } })
    expect(Object.keys(untruncated)).toEqual(
      expect.arrayContaining([
        "mcpServer",
        "truncated",
        "outputPath",
        "fullOutputPath",
        "originalSize",
        "truncatedTo",
        "contentHint",
      ]),
    )
    const truncated = mcpResultPartMetadata(
      { metadata: { outputPath: "/etc/shadow" } },
      {
        truncated: true,
        outputPath: "/tmp/trunc/1",
        fullOutputPath: "/tmp/trunc/1.full",
        originalSize: 99,
        truncatedTo: 10,
        contentHint: "text",
      },
    )
    expect(truncated.outputPath).toBe("/tmp/trunc/1")
    expect(truncated.fullOutputPath).toBe("/tmp/trunc/1.full")
    expect(truncated).toMatchObject({ mcpServer: { outputPath: "/etc/shadow" } })
    const empty = mcpResultPartMetadata({}, { truncated: false })
    expect(empty).not.toHaveProperty("mcpServer")
    expect(empty.truncated).toBe(false)
  })
})

describe("boundedJsonStringify", () => {
  test("matches JSON.stringify for plain data", () => {
    const sparse: unknown[] = new Array(3)
    sparse[1] = "hole"
    const corpus: unknown[] = [
      { a: 1 },
      { ok: true, count: 2 },
      [1, "two", null, false],
      { nested: { deep: [{ leaf: "x" }] } },
      { quote: 'say "hi"', slash: "a\\b", newline: "x\ny", tab: "a\tb" },
      { controls: "\x01\x02\x1f\x7f", unicode: "\u20ac\ud83d\ude00\u4e2d\u6587", lone: "\ud800", trail: "\udc00" },
      { splitPair: `${"x".repeat(1023)}😀${"y".repeat(1023)}` },
      { zero: 0, negativeZero: -0, big: 1e21, small: 1e-7, nan: Number.NaN, inf: Number.POSITIVE_INFINITY },
      { nil: null, yes: true, no: false },
      {},
      [],
      { empty: {}, list: [] },
      sparse,
      { skip: undefined, fn: () => 1, [Symbol("s")]: 1, keep: "v" },
      [undefined, () => 2, Symbol("t"), "v"],
      { date: new Date("2024-01-02T03:04:05.678Z") },
      { "odd key\n": 'odd"value\\' },
      "bare",
      42,
      true,
      null,
    ]
    for (const value of corpus) {
      const rendered = boundedJsonStringify(value, 1024 * 1024)
      expect(rendered?.text).toBe(JSON.stringify(value))
      expect(rendered?.truncated).toBe(false)
    }
    expect(boundedJsonStringify(undefined, 1024)).toBeUndefined()
    expect(boundedJsonStringify(() => 1, 1024)).toBeUndefined()
    expect(boundedJsonStringify(Symbol("x"), 1024)).toBeUndefined()
  })

  test("stays bounded past hostile input", () => {
    const huge = { blob: "y".repeat(20 * 1024 * 1024) }
    const capped = boundedJsonStringify(huge, 8 * 1024 * 1024)
    expect(capped?.truncated).toBe(true)
    // Raw budgeted prefix: at most one byte over for the mid-string cut, no
    // closers or notice. The caller reports the cut through its own notice.
    expect(Buffer.byteLength(capped!.text, "utf8")).toBeLessThanOrEqual(8 * 1024 * 1024 + 1)
    expect(capped!.text.startsWith('{"blob":"')).toBe(true)
    const controls = { soup: "\x01".repeat(1024 * 1024) }
    const escaped = boundedJsonStringify(controls, 64 * 1024)
    expect(escaped?.truncated).toBe(true)
    expect(Buffer.byteLength(escaped!.text, "utf8")).toBeLessThanOrEqual(64 * 1024 + 1)
  })

  test("a split surrogate pair never overcharges the byte budget", () => {
    // Lead surrogate lands exactly on the 1024-unit chunk edge; the pair must
    // stay in one chunk so the budget sees 4 bytes, not 3 + 3.
    const value = { s: `${"x".repeat(1023)}😀` }
    const exact = Buffer.byteLength(JSON.stringify(value), "utf8")
    expect(boundedJsonStringify(value, exact)?.truncated).toBe(false)
    expect(boundedJsonStringify(value, exact - 1)?.truncated).toBe(true)
  })

  test("enumerates lazily without key or index arrays", () => {
    // A 50M sparse array would need a 400 MB index array under Array.from;
    // the walker keeps length plus position and aborts on the byte budget.
    const sparse: unknown[] = new Array(50_000_000)
    const rendered = boundedJsonStringify(sparse, 64 * 1024)
    expect(rendered?.truncated).toBe(true)
    expect(rendered!.text.startsWith("[null,null")).toBe(true)
    expect(Buffer.byteLength(rendered!.text, "utf8")).toBeLessThanOrEqual(64 * 1024 + 1)
  })

  test("mass skipped properties abort instead of walking forever", () => {
    const wide: Record<string, unknown> = {}
    for (let index = 0; index < 1_100_000; index++) wide[`k${index}`] = undefined
    const rendered = boundedJsonStringify(wide, 64 * 1024 * 1024)
    expect(rendered?.truncated).toBe(true)
  })

  test("inherited keys count toward the enumeration cap", () => {
    const proto: Record<string, unknown> = {}
    for (let index = 0; index < 1_100_000; index++) proto[`p${index}`] = index
    const rendered = boundedJsonStringify(Object.create(proto), 64 * 1024 * 1024)
    expect(rendered?.truncated).toBe(true)
    expect(boundedJsonStringify(Object.assign(Object.create({ hidden: 1 }), { shown: 2 }), 1024)?.text).toBe(
      '{"shown":2}',
    )
  })

  test("throwing getters and revoked proxies degrade to undefined", () => {
    const getter = {
      get evil(): unknown {
        throw new Error("must not propagate")
      },
    }
    expect(boundedJsonStringify({ nested: getter }, 1024)).toBeUndefined()
    const { proxy, revoke } = Proxy.revocable({ a: 1 }, {})
    revoke()
    expect(boundedJsonStringify(proxy, 1024)).toBeUndefined()
    expect(collectMcpToolResult({ structuredContent: proxy }).textParts).toEqual([])
    expect(mcpResultMetadata({ metadata: proxy as never })).toEqual({})
  })

  test("rejects circular values and bigints like JSON.stringify", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    expect(boundedJsonStringify(circular, 1024)).toBeUndefined()
    expect(boundedJsonStringify({ n: 10n }, 1024)).toBeUndefined()
    expect(boundedJsonStringify([1n], 1024)).toBeUndefined()
    const shared = { v: 1 }
    expect(boundedJsonStringify({ a: shared, b: shared }, 1024)?.text).toBe('{"a":{"v":1},"b":{"v":1}}')
  })

  test("deep nesting aborts as truncated instead of faking a complete copy", () => {
    let deep: Record<string, unknown> = { leaf: true }
    for (let index = 0; index < 1000; index++) deep = { next: deep }
    const rendered = boundedJsonStringify(deep, 1024 * 1024)
    expect(rendered?.truncated).toBe(true)
    // Callers treat truncated:false as intact: a silent placeholder would
    // persist mutated metadata as complete and hide the lost subtree.
    expect(mcpResultMetadata({ metadata: deep })).toEqual({})
    const { textParts } = collectMcpToolResult({ structuredContent: deep })
    expect(textParts.join("\n")).toContain("truncated at")
  })

  test("ignores toJSON instead of running caller code", () => {
    const sneaky = { toJSON: () => "x".repeat(1024 * 1024) }
    expect(boundedJsonStringify(sneaky, 1024 * 1024)?.text).toBe("{}")
    const throwing = {
      nested: {
        toJSON: () => {
          throw new Error("must not run")
        },
      },
    }
    expect(boundedJsonStringify(throwing, 1024)?.text).toBe('{"nested":{}}')
  })
})
