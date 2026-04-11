import { describe, expect, test } from "bun:test"
import { AuditReport } from "../../src/audit/report"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { EventQuery } from "../../src/replay/query"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import path from "path"
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

  test("includes explainable risk evidence from session diff", async () => {
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
        Recorder.emit({ type: "session.end", sessionID: sid, reason: "completed", totalSteps: 0 })
        Recorder.end(sid)
        await new Promise((r) => setTimeout(r, 50))

        await Storage.write(
          ["session_diff", sid],
          [
            {
              file: path.join(tmp.path, "src/server/routes/demo.ts"),
              before: "export const a = 1\n",
              after: Array.from({ length: 130 }, (_, i) => `export const v${i} = ${i}\n`).join(""),
              additions: 130,
              deletions: 1,
              status: "modified",
            },
          ],
        )

        const report = await AuditReport.generate(sid)
        expect(report).toContain("- **Lines changed:** 131")
        expect(report).toContain("- **Validation coverage:** no validation run recorded (+25)")
        expect(report).toContain("- **API surface:** 1 route files affected (+15)")

        EventQuery.deleteBySession(sid)
      },
    })
  })
})
