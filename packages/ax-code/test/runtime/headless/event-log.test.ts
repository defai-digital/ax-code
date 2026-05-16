import { describe, expect, test } from "bun:test"
import {
  decodeHeadlessEventLogLine,
  decodeHeadlessEventLogRecord,
  encodeHeadlessEventLogRecord,
} from "../../../src/runtime/headless"

describe("headless event log", () => {
  test("encodes raw records as newline-delimited JSON", () => {
    expect(encodeHeadlessEventLogRecord({ type: "mcp.tools.changed" })).toBe('{"type":"mcp.tools.changed"}\n')
    expect(encodeHeadlessEventLogRecord(undefined)).toBe("null\n")
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

  test("ignores records that are outside the headless event contract", () => {
    expect(decodeHeadlessEventLogRecord({ type: "not.headless" })).toBeUndefined()
    expect(decodeHeadlessEventLogRecord({ details: { type: "not.headless" } })).toBeUndefined()
    expect(decodeHeadlessEventLogLine("")).toBeUndefined()
  })
})
