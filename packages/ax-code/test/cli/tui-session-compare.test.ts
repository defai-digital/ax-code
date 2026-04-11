import { describe, expect, test } from "bun:test"
import path from "path"
import { Recorder } from "../../src/replay/recorder"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Storage } from "../../src/storage/storage"
import { SessionCompare } from "../../src/cli/cmd/tui/routes/session/compare"
import { tmpdir } from "../fixture/fixture"

async function seed(input: {
  sessionID: string
  directory: string
  route: { from: string; to: string; confidence: number }
  files: string[]
  validate?: boolean
  fail?: boolean
}) {
  Recorder.begin(input.sessionID as Parameters<typeof Recorder.begin>[0])
  Recorder.emit({
    type: "session.start",
    sessionID: input.sessionID,
    agent: input.route.from,
    model: "test/model",
    directory: input.directory,
  })
  Recorder.emit({
    type: "agent.route",
    sessionID: input.sessionID,
    fromAgent: input.route.from,
    toAgent: input.route.to,
    confidence: input.route.confidence,
  })
  Recorder.emit({ type: "step.start", sessionID: input.sessionID, stepIndex: 1 })
  Recorder.emit({
    type: "llm.output",
    sessionID: input.sessionID,
    stepIndex: 1,
    parts: [
      ...input.files.flatMap((file, idx) => [
        { type: "tool_call" as const, callID: `read-${idx}`, tool: "read", input: { filePath: file } },
        { type: "tool_call" as const, callID: `edit-${idx}`, tool: "edit", input: { filePath: file } },
      ]),
      ...(input.validate
        ? [{ type: "tool_call" as const, callID: "bash-0", tool: "bash", input: { command: "bun test" } }]
        : []),
    ],
  })

  for (const [idx, file] of input.files.entries()) {
    Recorder.emit({
      type: "tool.call",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "read",
      callID: `read-${idx}`,
      input: { filePath: file },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "read",
      callID: `read-${idx}`,
      status: "completed",
      output: "ok",
      durationMs: 20 + idx,
    })
    Recorder.emit({
      type: "tool.call",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "edit",
      callID: `edit-${idx}`,
      input: { filePath: file },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "edit",
      callID: `edit-${idx}`,
      status: input.fail ? "error" : "completed",
      output: input.fail ? undefined : "ok",
      error: input.fail ? "edit failed" : undefined,
      durationMs: 40 + idx,
    })
  }

  if (input.validate) {
    Recorder.emit({
      type: "tool.call",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "bash",
      callID: "bash-0",
      input: { command: "bun test" },
    })
    Recorder.emit({
      type: "tool.result",
      sessionID: input.sessionID,
      stepIndex: 1,
      tool: "bash",
      callID: "bash-0",
      status: "completed",
      output: "bun test 1 passed",
      durationMs: 80,
    })
  }

  Recorder.emit({
    type: "step.finish",
    sessionID: input.sessionID,
    stepIndex: 1,
    finishReason: "stop",
    tokens: { input: 12, output: 8 },
  })
  Recorder.emit({ type: "session.end", sessionID: input.sessionID, reason: "completed", totalSteps: 1 })
  Recorder.end(input.sessionID as Parameters<typeof Recorder.end>[0])

  await Storage.write(
    ["session_diff", input.sessionID],
    input.files.map((file, idx) => ({
      file,
      before: "export const a = 1\n",
      after:
        idx === 0
          ? Array.from({ length: 130 }, (_, i) => `export const v${i} = ${i}\n`).join("")
          : "export const a = 2\n",
      additions: idx === 0 ? 130 : 1,
      deletions: 1,
      status: "modified" as const,
    })),
  )
}

describe("tui session compare helpers", () => {
  test("ranks compare targets and formats execution details", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const safe = await Session.create({ title: "safe" })
        const risky = await Session.fork({ sessionID: safe.id })

        await seed({
          sessionID: safe.id,
          directory: tmp.path,
          route: { from: "build", to: "debug", confidence: 0.92 },
          files: [path.join(tmp.path, "src/demo.ts")],
          validate: true,
        })
        await seed({
          sessionID: risky.id,
          directory: tmp.path,
          route: { from: "build", to: "security", confidence: 0.71 },
          files: [
            path.join(tmp.path, "src/server/routes/risky.ts"),
            path.join(tmp.path, "src/lib/a.ts"),
            path.join(tmp.path, "src/lib/b.ts"),
          ],
          fail: true,
        })

        const sessions = [
          { id: safe.id, title: safe.title },
          { id: risky.id, title: risky.title },
        ]
        const targets = SessionCompare.targets({
          currentID: risky.id,
          sessions,
        })

        expect(targets).toHaveLength(1)
        expect(targets[0]?.id).toBe(`target:${safe.id}`)
        expect(targets[0]?.title).toBe(safe.title)
        expect(targets[0]?.description).toContain("recommended")
        expect(targets[0]?.footer).toContain("risk")
        expect(targets[0]?.sessionID).toBe(safe.id)

        const detail = SessionCompare.detail({
          currentID: risky.id,
          otherID: safe.id,
          sessions,
          deep: true,
        })

        expect(detail?.advisory.winner).toBe("B")
        expect(detail?.decision.winner).toBe("B")
        expect(SessionCompare.summary(detail!)).toContain(`prefer ${safe.title}`)
        expect(SessionCompare.entries(detail!).some((item) => item.category === "Decision")).toBe(true)
        expect(SessionCompare.entries(detail!).some((item) => item.title === `Recommendation · ${safe.title}`)).toBe(true)
        expect(SessionCompare.entries(detail!).some((item) => item.category === "Replay")).toBe(true)
        expect(SessionCompare.entries(detail!).some((item) => item.title === `B · ${safe.title}`)).toBe(true)
      },
    })
  })
})
