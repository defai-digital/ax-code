import { describe, expect, test } from "vitest"
import {
  decodeTraceLogEntryValue,
  formatTraceLogTime,
  parseTraceLogEntryJsonLine,
  parseTraceTextLogLine,
} from "../../src/cli/cmd/trace"

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
    expect(
      parseTraceLogEntryJsonLine(`  ${JSON.stringify({ level: "INFO", service: "session", msg: "started" })}\n`),
    ).toEqual({
      level: "INFO",
      service: "session",
      msg: "started",
    })
    expect(parseTraceLogEntryJsonLine("[]")).toBeUndefined()
    expect(parseTraceLogEntryJsonLine("")).toBeUndefined()
    expect(parseTraceLogEntryJsonLine("{not json")).toBeUndefined()
  })

  test("parseTraceTextLogLine rejects malformed duration values", () => {
    expect(
      parseTraceTextLogLine(
        "INFO 2026-04-23T00:03:30.132Z +42ms service=tool command=read durationMs=123 status=ok done",
      ),
    ).toMatchObject({
      level: "INFO",
      time: "2026-04-23T00:03:30.132Z",
      service: "tool",
      command: "read",
      durationMs: 123,
      status: "ok",
      msg: "done",
    })

    expect(parseTraceTextLogLine("INFO 2026-04-23T00:03:30.132Z +42ms durationMs=1e3 done")?.durationMs).toBeUndefined()
    expect(
      parseTraceTextLogLine("INFO 2026-04-23T00:03:30.132Z +42ms durationMs=0x10 done")?.durationMs,
    ).toBeUndefined()
    expect(
      parseTraceTextLogLine("INFO 2026-04-23T00:03:30.132Z +42ms durationMs=12.5 done")?.durationMs,
    ).toBeUndefined()
  })

  test("formatTraceLogTime handles out-of-range numeric timestamps", () => {
    expect(formatTraceLogTime({ time: Date.parse("2026-04-23T00:03:30.132Z") })).toBe("00:03:30")
    expect(formatTraceLogTime({ time: "2026-04-23T00:03:30.132Z" })).toBe("00:03:30")
    expect(() => formatTraceLogTime({ time: Number.MAX_VALUE })).not.toThrow()
    expect(formatTraceLogTime({ time: Number.MAX_VALUE })).toBe("")
  })
})
