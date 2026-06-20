import { describe, expect, test } from "vitest"
import {
  decodeHeadlessEventLogLine,
  decodeHeadlessEventLogRecord,
  encodeHeadlessEventLogRecord,
  parseHeadlessEventLogJsonLine,
} from "../../../src/runtime/headless"

describe("headless event log", () => {
  test("encodes raw records as newline-delimited JSON", () => {
    expect(encodeHeadlessEventLogRecord({ type: "mcp.tools.changed" })).toBe('{"type":"mcp.tools.changed"}\n')
    expect(encodeHeadlessEventLogRecord(undefined)).toBe("null\n")
  })

  test("encodes records with bigint and circular payloads without throwing", () => {
    const record: Record<string, unknown> = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_1",
          sessionID: "ses_1",
          sequence: 1n,
        },
      },
    }
    record.self = record

    const encoded = encodeHeadlessEventLogRecord(record)

    expect(encoded).toBe(
      '{"type":"message.updated","properties":{"info":{"id":"msg_1","sessionID":"ses_1","sequence":"1"}},"self":"[Circular]"}\n',
    )
    expect(decodeHeadlessEventLogLine(encoded)?.type).toBe("message.updated")
  })

  test("encodes a serialization error record when JSON conversion throws", () => {
    const encoded = encodeHeadlessEventLogRecord({
      toJSON() {
        throw new Error("cannot serialize")
      },
    })

    expect(JSON.parse(encoded)).toEqual({
      type: "headless.event_log.serialization_error",
      error: "cannot serialize",
    })
  })

  test("decodes raw events and server event envelopes through the same boundary", () => {
    const raw = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_1",
          sessionID: "ses_1",
        },
      },
    }
    const enveloped = {
      details: raw,
    }

    expect(decodeHeadlessEventLogRecord(raw)?.type).toBe("message.updated")
    expect(decodeHeadlessEventLogRecord(enveloped)?.type).toBe("message.updated")
    expect(decodeHeadlessEventLogLine(JSON.stringify(enveloped))?.type).toBe("message.updated")
  })

  test("parses newline-delimited JSON records before event decoding", () => {
    const raw = {
      type: "message.updated",
      properties: {
        info: {
          id: "msg_1",
          sessionID: "ses_1",
        },
      },
    }
    const enveloped = { details: raw }

    expect(parseHeadlessEventLogJsonLine(`${JSON.stringify(raw)}\n`)).toEqual(raw)
    expect(parseHeadlessEventLogJsonLine(JSON.stringify(enveloped))).toEqual(enveloped)
    expect(parseHeadlessEventLogJsonLine("")).toBeUndefined()
    expect(parseHeadlessEventLogJsonLine("{")).toBeUndefined()
  })

  test("ignores records that are outside the headless event contract", () => {
    expect(decodeHeadlessEventLogRecord({ type: "not.headless" })).toBeUndefined()
    expect(decodeHeadlessEventLogRecord({ details: { type: "not.headless" } })).toBeUndefined()
    expect(decodeHeadlessEventLogLine("")).toBeUndefined()
  })
})
