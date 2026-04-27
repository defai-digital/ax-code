import { describe, expect, test } from "bun:test"
import { AuditReport } from "../../src/audit/report"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("audit report routing", () => {
  test("shows delegate and switch route entries distinctly", async () => {
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
        Recorder.emit({
          type: "agent.route",
          sessionID: sid,
          fromAgent: "build",
          toAgent: "perf",
          confidence: 0.92,
          routeMode: "delegate",
          matched: ["performance", "profile"],
        })
        Recorder.emit({
          type: "agent.route",
          sessionID: sid,
          fromAgent: "build",
          toAgent: "security",
          confidence: 0.88,
          routeMode: "switch",
          matched: ["security", "scan"],
        })
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 0 })

        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        const report = await AuditReport.generate(sid)
        expect(report).toContain("## Routing")
        expect(report).toContain("delegate `build` -> `perf` (0.92) [performance, profile]")
        expect(report).toContain("switch `build` -> `security` (0.88) [security, scan]")

        EventQuery.deleteBySession(sid)
      },
    })
  })
})
