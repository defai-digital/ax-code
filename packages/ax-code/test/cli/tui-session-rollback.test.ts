import { describe, expect, test } from "bun:test"
import path from "path"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Recorder } from "../../src/replay/recorder"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionRollback } from "../../src/cli/cmd/tui/routes/session/rollback"
import { tmpdir } from "../fixture/fixture"

type Sid = Awaited<ReturnType<typeof Session.create>>["id"]
type Mid = Awaited<ReturnType<typeof Session.updateMessage>>["id"]

function model() {
  return {
    providerID: ProviderID.make("openai"),
    modelID: ModelID.make("gpt-4"),
  }
}

async function user(sid: Sid, txt: string) {
  const msg = await Session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: sid,
    agent: "default",
    model: model(),
    time: {
      created: Date.now(),
    },
  })
  await Session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID: sid,
    type: "text",
    text: txt,
  })
  return msg
}

async function assistant(sid: Sid, pid: Mid, dir: string) {
  return Session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: sid,
    mode: "default",
    agent: "default",
    path: {
      cwd: dir,
      root: dir,
    },
    tokens: {
      output: 0,
      input: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
    modelID: ModelID.make("gpt-4"),
    providerID: ProviderID.make("openai"),
    parentID: pid,
    time: {
      created: Date.now(),
    },
    finish: "end_turn",
  } satisfies MessageV2.Assistant)
}

async function step(sid: Sid, mid: Mid, txt: string) {
  return Session.updatePart({
    id: PartID.ascending(),
    messageID: mid,
    sessionID: sid,
    type: "step-start",
  }).then(async (start) => {
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: mid,
      sessionID: sid,
      type: "text",
      text: txt,
    })
    await Session.updatePart({
      id: PartID.ascending(),
      messageID: mid,
      sessionID: sid,
      type: "step-finish",
      reason: "stop",
      tokens: {
        total: 0,
        input: 0,
        output: 0,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    })
    return start
  })
}

describe("tui session rollback helpers", () => {
  test("loads rollback points and formats summary entries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const usr = await user(ses.id, "inspect")
        const aid = await assistant(ses.id, usr.id, tmp.path)
        const start = await step(ses.id, aid.id, "first")
        const file = path.join(tmp.path, "src/demo.ts")

        Recorder.begin(ses.id)
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 1 })
        Recorder.emit({
          type: "tool.call",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 1,
          tool: "read",
          callID: "read-1",
          input: { filePath: file },
        })
        Recorder.emit({
          type: "tool.result",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 1,
          tool: "read",
          callID: "read-1",
          status: "completed",
          output: "ok",
          durationMs: 15,
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 8, output: 4 },
        })
        Recorder.end(ses.id)
        await new Promise((done) => setTimeout(done, 50))

        const points = SessionRollback.load(
          ses.id,
          (
            await Session.messages({
              sessionID: ses.id,
            })
          ).map((item) => ({
            info: item.info,
            parts: item.parts,
          })),
        )

        expect(points).toHaveLength(1)
        expect(points[0]).toMatchObject({
          step: 1,
          messageID: aid.id,
          partID: start.id,
          tokens: { input: 8, output: 4 },
          tools: ["read: demo.ts"],
          kinds: ["read"],
        })
        expect(points[0]?.duration).toBeGreaterThanOrEqual(0)
        expect(SessionRollback.summary(points)).toBe("rollback point: step 1")
        expect(SessionRollback.find(points, "summary")).toBeUndefined()
        expect(SessionRollback.find(points, "tool:read")).toMatchObject({
          step: 1,
          messageID: aid.id,
          partID: start.id,
        })
        expect(SessionRollback.find(points, "step:1")).toMatchObject({
          step: 1,
          messageID: aid.id,
          partID: start.id,
        })
        expect(
          SessionRollback.promptID(
            (
              await Session.messages({
                sessionID: ses.id,
              })
            ).map((item) => ({
              info: item.info,
              parts: item.parts,
            })),
            points[0]!,
          ),
        ).toBe(usr.id)
        expect(SessionRollback.entries(points)).toEqual([
          {
            id: "summary",
            title: "1 rollback point",
            description: "steps 1 → 1",
            footer: "read: demo.ts",
            category: "Overview",
          },
          {
            id: "tool:read",
            title: "Latest read",
            description: "read: demo.ts",
            footer: "step 1 · 0s · 8/4 tokens",
            category: "Tools",
          },
          {
            id: "step:1",
            title: "Step 1",
            description: "read: demo.ts",
            footer: "0s · 8/4 tokens · 1 tool",
            category: "Rollback",
          },
        ])
      },
    })
  })
})
