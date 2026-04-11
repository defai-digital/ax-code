import { describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Recorder } from "../../src/replay/recorder"
import { Risk } from "../../src/risk/score"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { tmpdir } from "../fixture/fixture"

describe("risk score", () => {
  test("uses session diff data for churn and breakdown", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await Storage.write(
          ["session_diff", session.id],
          [
            {
              file: path.join(tmp.path, "src/server/routes/demo.ts"),
              before: "export const a = 1\n",
              after: Array.from({ length: 120 }, (_, i) => `export const v${i} = ${i}\n`).join(""),
              additions: 120,
              deletions: 1,
              status: "modified",
            },
          ],
        )

        const risk = Risk.fromSession(session.id)

        expect(risk.signals.filesChanged).toBe(1)
        expect(risk.signals.linesChanged).toBe(121)
        expect(risk.signals.apiEndpointsAffected).toBe(1)
        expect(risk.level).toBe("MEDIUM")
        expect(risk.score).toBe(34)
        expect(risk.readiness).toBe("needs_validation")
        expect(risk.confidence).toBeGreaterThan(0.6)
        expect(risk.summary).toBe("1 files changed, rewrite, 1 API endpoints")
        expect(risk.unknowns).toContain("no validation command recorded for code changes")
        expect(Risk.explain(risk, 3)).toContain("Code churn: 121 lines changed (+12)")
        expect(Risk.explain(risk, 3)).toContain("API surface: 1 route files affected (+12)")
        expect(Risk.explain(risk, 3)).toContain("Semantic change: rewrite classified as high risk (+10)")
      },
    })
  })

  test("records validation evidence from bash commands", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const file = path.join(tmp.path, "src/demo.ts")

        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          stepIndex: 1,
          tool: "edit",
          callID: "edit-1",
          input: { filePath: file },
        })
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          stepIndex: 1,
          tool: "bash",
          callID: "bash-1",
          input: { command: "bun test" },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: session.id,
          stepIndex: 1,
          tool: "bash",
          callID: "bash-1",
          status: "completed",
          output: "5 pass\n0 fail",
          durationMs: 120,
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 25))

        await Storage.write(
          ["session_diff", session.id],
          [
            {
              file,
              before: "export const demo = 1\n",
              after: "export const demo = 2\n",
              additions: 1,
              deletions: 1,
              status: "modified",
            },
          ],
        )

        const risk = Risk.fromSession(session.id)

        expect(risk.signals.validationState).toBe("passed")
        expect(risk.signals.validationCommands).toEqual(["bun test"])
        expect(risk.readiness).toBe("ready")
        expect(risk.evidence).toContain("validation recorded: bun test")
        expect(risk.unknowns).not.toContain("no validation command recorded for code changes")
      },
    })
  })

  test("does not derive churn from step tokens when no diff exists", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const file = path.join(tmp.path, "src/demo.ts")

        Recorder.begin(session.id)
        Recorder.emit({
          type: "tool.call",
          sessionID: session.id,
          stepIndex: 1,
          tool: "edit",
          callID: "edit-1",
          input: { filePath: file },
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: session.id,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 20, output: 800 },
        })
        Recorder.end(session.id)
        await new Promise((resolve) => setTimeout(resolve, 25))

        const risk = Risk.fromSession(session.id)

        expect(risk.signals.filesChanged).toBe(1)
        expect(risk.signals.linesChanged).toBe(0)
        expect(risk.signals.diffState).toBe("derived")
        expect(risk.readiness).toBe("needs_validation")
        expect(risk.breakdown.some((item) => item.kind === "lines")).toBe(false)
      },
    })
  })
})
