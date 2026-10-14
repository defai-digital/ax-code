import { describe, expect, test } from "vitest"
import { AuditExport } from "../../src/audit/export"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Recorder } from "../../src/replay/recorder"
import { tmpdir } from "../fixture/fixture"

describe("AuditExport redaction", () => {
  test("does not export credentials carried by a tool result", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "audit export redaction" })
        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          tool: "bash",
          callID: "call-secret",
          status: "completed",
          output: "export API_TOKEN=abc123 && curl -H 'Authorization: Bearer super-secret-token' x",
          durationMs: 1,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 50))

        const exported = [...AuditExport.stream(session.id)].join("\n")
        expect(exported.length).toBeGreaterThan(0)
        expect(exported).not.toContain("super-secret-token")
        expect(exported).not.toContain("abc123")
      },
    })
  })
})
