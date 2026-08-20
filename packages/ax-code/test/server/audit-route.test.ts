import { describe, expect, test } from "vitest"
import {
  auditSessionIDsForDirectory,
  collectAuditExportRecords,
  parseAuditJsonLine,
} from "../../src/server/routes/audit"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("audit route JSONL decoding", () => {
  test("parses valid audit JSON lines", () => {
    expect(parseAuditJsonLine(JSON.stringify({ session_id: "ses_1", event_type: "tool.call" }))).toEqual({
      session_id: "ses_1",
      event_type: "tool.call",
    })
  })

  test("skips corrupt audit JSON lines", () => {
    expect(parseAuditJsonLine("{truncated")).toBeNull()
  })

  test("collects audit export records without materializing past the route limit", async () => {
    const lines = [
      JSON.stringify({ session_id: "ses_1", event_type: "tool.call" }),
      "{truncated",
      JSON.stringify({ session_id: "ses_1", event_type: "tool.result" }),
      JSON.stringify({ session_id: "ses_1", event_type: "agent.route" }),
    ]

    const records = await collectAuditExportRecords(lines, { limit: 2 })

    expect(records).toHaveLength(2)
    expect(records.map((record) => record.event_type)).toEqual(["tool.call", "tool.result"])
  })

  test("filters audit export records before applying the route limit", async () => {
    const lines = [
      JSON.stringify({ session_id: "ses_1", event_type: "tool.call" }),
      JSON.stringify({ session_id: "ses_1", event_type: "tool.result" }),
      JSON.stringify({ session_id: "ses_1", event_type: "tool.result" }),
    ]

    const records = await collectAuditExportRecords(lines, { limit: 2, type: "tool.result" })

    expect(records).toHaveLength(2)
    expect(records.every((record) => record.event_type === "tool.result")).toBe(true)
  })

  test("filters audit export records by allowed session before applying the route limit", async () => {
    const lines = [
      JSON.stringify({ session_id: "ses_other_1", event_type: "tool.call" }),
      JSON.stringify({ session_id: "ses_other_2", event_type: "tool.result" }),
      JSON.stringify({ session_id: "ses_allowed", event_type: "agent.route" }),
      JSON.stringify({ session_id: "ses_allowed", event_type: "tool.call" }),
    ]

    const records = await collectAuditExportRecords(lines, {
      limit: 2,
      sessionIDs: new Set(["ses_allowed"]),
    })

    expect(records).toHaveLength(2)
    expect(records.map((record) => record.session_id)).toEqual(["ses_allowed", "ses_allowed"])
    expect(records.map((record) => record.event_type)).toEqual(["agent.route", "tool.call"])
  })

  test("includes project sessions beyond the default 100-row session page", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ids: string[] = []
        for (let index = 0; index < 101; index++) {
          ids.push((await Session.create({ title: `Audit session ${index}` })).id)
        }

        const allowed = auditSessionIDsForDirectory(tmp.path)
        expect(allowed.size).toBe(101)
        expect(ids.every((id) => allowed.has(id))).toBe(true)
      },
    })
  })
})
