import { describe, expect, test } from "bun:test"
import { ACP } from "../../src/acp/agent"

describe("ACP todo plan entry decoding", () => {
  test("decodes parsed todo values into ACP plan entries", () => {
    const entries = ACP.decodeTodoPlanEntries([
      { content: "Wire command", status: "pending", priority: "high" },
      { content: "Run validation", status: "in_progress", priority: "medium" },
      { content: "Document result", status: "completed", priority: "low" },
      { content: "Drop obsolete path", status: "cancelled", priority: "low" },
    ])

    expect(entries).toEqual([
      { priority: "medium", status: "pending", content: "Wire command" },
      { priority: "medium", status: "in_progress", content: "Run validation" },
      { priority: "medium", status: "completed", content: "Document result" },
      { priority: "medium", status: "completed", content: "Drop obsolete path" },
    ])
  })

  test("parses serialized todo output", () => {
    const entries = ACP.parseTodoPlanEntries(
      `  ${JSON.stringify([{ content: "Review", status: "pending", priority: "medium" }])}\n`,
    )

    expect(entries).toEqual([{ priority: "medium", status: "pending", content: "Review" }])
  })

  test("returns null for invalid JSON", () => {
    expect(ACP.parseTodoPlanEntries("not-json")).toBeNull()
    expect(ACP.parseTodoPlanEntries("")).toBeNull()
  })

  test("returns null for malformed todo values", () => {
    expect(ACP.decodeTodoPlanEntries([{ content: "Review", status: "blocked", priority: "medium" }])).toBeNull()
  })
})

describe("ACP replay data URL decoding", () => {
  test("decodes base64 text data URLs", () => {
    const body = "hello world"
    expect(
      ACP.decodeReplayDataUrl(`data:text/plain;base64,${Buffer.from(body).toString("base64")}`, "text/plain"),
    ).toEqual({
      mimeType: "text/plain",
      base64Data: Buffer.from(body).toString("base64"),
      text: body,
    })
  })

  test("decodes data URLs case-insensitively", () => {
    const body = "hello world"
    expect(
      ACP.decodeReplayDataUrl(`DATA:text/plain;base64,${Buffer.from(body).toString("base64")}`, "text/plain"),
    ).toEqual({
      mimeType: "text/plain",
      base64Data: Buffer.from(body).toString("base64"),
      text: body,
    })
  })

  test("rejects invalid base64 data URL payloads", () => {
    expect(ACP.decodeReplayDataUrl("data:text/plain;base64,not base64!!", "text/plain")).toEqual({
      mimeType: "text/plain",
      base64Data: "",
      text: "",
    })
  })

  test("decodes percent-escaped base64 data URL payloads", () => {
    const body = Buffer.from([251, 255])
    const base64 = body.toString("base64")
    expect(ACP.decodeReplayDataUrl(`data:application/octet-stream;base64,${encodeURIComponent(base64)}`, "text/plain")).toEqual({
      mimeType: "application/octet-stream",
      base64Data: base64,
      text: body.toString("utf-8"),
    })
  })

  test("normalizes whitespace in base64 data URL payloads", () => {
    const base64 = Buffer.from("wrapped").toString("base64")
    const wrapped = `${base64.slice(0, 4)}\n ${base64.slice(4)}`
    expect(ACP.decodeReplayDataUrl(`data:text/plain;base64,${wrapped}`, "text/plain")).toEqual({
      mimeType: "text/plain",
      base64Data: base64,
      text: "wrapped",
    })
  })

  test("decodes plain text data URLs without dropping content", () => {
    expect(ACP.decodeReplayDataUrl("data:text/plain,hello%20world", "application/octet-stream")).toEqual({
      mimeType: "text/plain",
      base64Data: Buffer.from("hello world").toString("base64"),
      text: "hello world",
    })
  })
})

describe("ACP session list cursor parsing", () => {
  test("parses finite non-negative integer cursors", () => {
    expect(ACP.parseListSessionsCursor(undefined)).toBeUndefined()
    expect(ACP.parseListSessionsCursor(null)).toBeUndefined()
    expect(ACP.parseListSessionsCursor("")).toBeUndefined()
    expect(ACP.parseListSessionsCursor(" 0 ")).toBe(0)
    expect(ACP.parseListSessionsCursor("1710000000000")).toBe(1710000000000)
  })

  test("rejects invalid cursors instead of treating them as the first page", () => {
    expect(() => ACP.parseListSessionsCursor("abc")).toThrow()
    expect(() => ACP.parseListSessionsCursor("1.5")).toThrow()
    expect(() => ACP.parseListSessionsCursor("1e3")).toThrow()
    expect(() => ACP.parseListSessionsCursor("0x10")).toThrow()
    expect(() => ACP.parseListSessionsCursor("-1")).toThrow()
  })
})
