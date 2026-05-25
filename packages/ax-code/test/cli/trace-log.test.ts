import { describe, expect, test } from "bun:test"
import { decodeTraceLogEntryValue, parseTraceLogEntryJsonLine } from "../../src/cli/cmd/trace"

describe("trace log entry decoding", () => {
  test("decodeTraceLogEntryValue decodes already-parsed log records", () => {
    expect(
      decodeTraceLogEntryValue({
        level: 30,
        time: 1710000000000,
        service: "session",
        msg: "started",
      }),
    ).toEqual({
      level: 30,
      time: 1710000000000,
      service: "session",
      msg: "started",
    })
    expect(decodeTraceLogEntryValue(["not", "record"])).toBeUndefined()
    expect(decodeTraceLogEntryValue(null)).toBeUndefined()
  })

  test("parseTraceLogEntryJsonLine parses raw JSON before record decoding", () => {
    expect(parseTraceLogEntryJsonLine(JSON.stringify({ level: "INFO", service: "session", msg: "started" }))).toEqual(
      {
        level: "INFO",
        service: "session",
        msg: "started",
      },
    )
    expect(parseTraceLogEntryJsonLine("[]")).toBeUndefined()
    expect(parseTraceLogEntryJsonLine("{not json")).toBeUndefined()
  })
})
