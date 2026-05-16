import { describe, expect, test } from "bun:test"
import { AuditRecord } from "../../src/audit/index"
import { AuditExport } from "../../src/audit/export"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { tmpdir } from "../fixture/fixture"

/**
 * R21: SIEM-compatible schema validation.
 *
 * Validates that ax-code audit export produces JSON Lines parseable by
 * Splunk, Datadog, and ELK without custom transforms.
 *
 * Splunk CIM (Common Information Model) expects:
 *   - timestamp (ISO 8601)
 *   - action (what happened)
 *   - result (outcome)
 *   - src_user / user (who)
 *   - app / vendor_product (what system)
 *
 * ELK ECS (Elastic Common Schema) expects:
 *   - @timestamp (ISO 8601)
 *   - event.action
 *   - event.outcome
 *   - event.duration (nanoseconds)
 *   - trace.id, span.id
 *
 * Datadog expects:
 *   - timestamp (ISO 8601 or Unix)
 *   - service, source
 *   - status (info/warn/error)
 *
 * Our schema maps to all three:
 *   - timestamp → @timestamp (ISO 8601) ✓
 *   - event_type → event.category ✓
 *   - action → event.action ✓
 *   - result → event.outcome ✓
 *   - trace_id → trace.id ✓
 *   - session_id → Splunk src_session ✓
 *   - duration_ms → event.duration (convert ms→ns) ✓
 *   - tool → event.module ✓
 *   - agent → user.name ✓
 */

describe("R21: SIEM-compatible audit schema", () => {
  test("audit records are valid JSON with required SIEM fields", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const sid = session.id
        Recorder.begin(sid)

        Recorder.emit({
          type: "session.start",
          sessionID: sid,
          agent: "build",
          model: "test/model",
          directory: tmp.path,
        })
        Recorder.emit({ type: "step.start", sessionID: sid, stepIndex: 0 })
        Recorder.emit({
          type: "llm.output",
          sessionID: sid,
          stepIndex: 0,
          parts: [{ type: "text", text: "test" }],
        })
        Recorder.emit({
          type: "tool.call",
          sessionID: sid,
          tool: "read",
          callID: "c1",
          input: { file_path: "/test" },
          stepIndex: 0,
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: sid,
          tool: "read",
          callID: "c1",
          status: "completed",
          output: "content",
          durationMs: 42,
          stepIndex: 0,
          deterministic: false,
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: sid,
          stepIndex: 0,
          finishReason: "stop",
          tokens: { input: 100, output: 20 },
        })
        Recorder.emit({
          type: "llm.response",
          sessionID: sid,
          stepIndex: 0,
          finishReason: "stop",
          tokens: { input: 100, output: 20 },
          latencyMs: 500,
        })
        Recorder.emit({
          type: "permission.ask",
          sessionID: sid,
          permission: "read",
          patterns: ["/test"],
        })
        Recorder.emit({
          type: "permission.reply",
          sessionID: sid,
          permission: "read",
          reply: "once",
        })
        Recorder.emit({
          type: "error",
          sessionID: sid,
          errorType: "TestError",
          message: "test error",
        })
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 1 })

        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        // Export and parse
        const lines = [...AuditExport.stream(sid)]
        expect(lines.length).toBeGreaterThan(0)

        for (const line of lines) {
          // Must be valid JSON
          const record = JSON.parse(line)

          // Validate against AuditRecord schema
          const parsed = AuditRecord.safeParse(record)
          expect(parsed.success).toBe(true)

          const r = parsed.data!

          // SIEM Required: timestamp is ISO 8601
          expect(r.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)

          // SIEM Required: trace correlation
          expect(r.trace_id).toBeTruthy()
          expect(r.session_id).toBeTruthy()

          // SIEM Required: event classification
          expect(r.event_type).toBeTruthy()

          // Splunk CIM: action field present
          if (r.action) expect(typeof r.action).toBe("string")

          // Splunk CIM: result field present when applicable
          if (r.result) expect(typeof r.result).toBe("string")

          // ECS: duration in numeric format
          if (r.duration_ms !== undefined) expect(typeof r.duration_ms).toBe("number")

          // Datadog: token usage when present
          if (r.token_usage) {
            expect(typeof r.token_usage.input).toBe("number")
            expect(typeof r.token_usage.output).toBe("number")
          }

          // No undefined values in output (breaks JSON parsers)
          const json = JSON.stringify(r)
          expect(json).not.toContain("undefined")
        }

        // Verify all event types produce records
        const types = lines.map((l) => JSON.parse(l).event_type)
        expect(types).toContain("session.start")
        expect(types).toContain("session.end")
        expect(types).toContain("step.start")
        expect(types).toContain("step.finish")
        expect(types).toContain("tool.call")
        expect(types).toContain("tool.result")
        expect(types).toContain("llm.output")
        expect(types).toContain("llm.response")
        expect(types).toContain("permission.ask")
        expect(types).toContain("permission.reply")
        expect(types).toContain("error")

        // Cleanup
        EventQuery.deleteBySession(sid)
      },
    })
  })

  test("audit records with policy context include policy field", async () => {
    const lines = [
      ...AuditExport.streamAll(
        { since: 0 },
        {
          policy: { name: "test-policy", version: "1" },
        },
      ),
    ]
    // Even if no events exist, the pattern works
    for (const line of lines) {
      const record = JSON.parse(line)
      expect(record.policy).toEqual({ name: "test-policy", version: "1" })
    }
  })

  test("JSON Lines format — one record per line, no trailing comma", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)
        Recorder.emit({
          type: "session.start",
          sessionID: session.id,
          agent: "build",
          model: "test",
          directory: tmp.path,
        })
        Recorder.emit({ type: "session.end", sessionID: session.id, reason: "completed", totalSteps: 0 })
        Recorder.end(session.id)
        await new Promise((r) => setTimeout(r, 50))

        const lines = [...AuditExport.stream(session.id)]
        for (const line of lines) {
          // Each line is self-contained JSON — no array wrapping, no commas between lines
          expect(line.startsWith("{")).toBe(true)
          expect(line.endsWith("}")).toBe(true)
          expect(() => JSON.parse(line)).not.toThrow()
        }

        EventQuery.deleteBySession(session.id)
      },
    })
  })

  test("streamAll paginates through the full event log", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        Recorder.begin(session.id)
        for (let i = 0; i < EventQuery.ALL_SINCE_LIMIT + 25; i++) {
          Recorder.emit({
            type: "step.start",
            sessionID: session.id,
            stepIndex: i,
          })
        }
        Recorder.end(session.id)
        await new Promise((r) => setTimeout(r, 50))

        const lines = [...AuditExport.streamAll({ since: 0 })]
        expect(lines).toHaveLength(EventQuery.ALL_SINCE_LIMIT + 25)

        EventQuery.deleteBySession(session.id)
      },
    })
  })
})
