import { describe, expect, test } from "bun:test"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionRollback } from "../../src/session/rollback"
import { MessageID, PartID } from "../../src/session/schema"
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

async function assistant(sid: Sid, pid: Mid) {
  return Session.updateMessage({
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: sid,
    mode: "default",
    agent: "default",
    path: {
      cwd: process.cwd(),
      root: process.cwd(),
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
  const start = await Session.updatePart({
    id: PartID.ascending(),
    messageID: mid,
    sessionID: sid,
    type: "step-start",
  })
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
}

describe("rollback command helpers", () => {
  test("maps replay steps onto assistant step boundaries", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const usr = await user(ses.id, "inspect")
        const aid = await assistant(ses.id, usr.id)
        const one = await step(ses.id, aid.id, "first")
        const two = await step(ses.id, aid.id, "second")

        Recorder.begin(ses.id)
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 1 })
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 2 })
        Recorder.end(ses.id)
        await new Promise((done) => setTimeout(done, 0))

        const msgs = await Session.messages({ sessionID: ses.id })
        const points = SessionRollback.resolve(msgs, EventQuery.bySession(ses.id))

        expect(points).toHaveLength(2)
        expect(points[0]).toEqual({ step: 1, messageID: aid.id, partID: one.id, tools: [], kinds: [] })
        expect(points[1]).toEqual({ step: 2, messageID: aid.id, partID: two.id, tools: [], kinds: [] })
      },
    })
  })

  test("selects the latest rollback point for a tool", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const usr = await user(ses.id, "inspect")
        const aid = await assistant(ses.id, usr.id)
        await step(ses.id, aid.id, "first")
        await step(ses.id, aid.id, "second")
        const three = await step(ses.id, aid.id, "third")

        Recorder.begin(ses.id)
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 1 })
        Recorder.emit({
          type: "tool.call",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 1,
          tool: "read",
          callID: "read-1",
          input: { filePath: `${tmp.path}/a.ts` },
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 1, output: 1 },
        })
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 2 })
        Recorder.emit({
          type: "tool.call",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 2,
          tool: "edit",
          callID: "edit-1",
          input: { filePath: `${tmp.path}/a.ts` },
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 2,
          finishReason: "stop",
          tokens: { input: 1, output: 1 },
        })
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 3 })
        Recorder.emit({
          type: "tool.call",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 3,
          tool: "edit",
          callID: "edit-2",
          input: { filePath: `${tmp.path}/b.ts` },
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 3,
          finishReason: "stop",
          tokens: { input: 1, output: 1 },
        })
        Recorder.end(ses.id)
        await new Promise((done) => setTimeout(done, 0))

        const points = await SessionRollback.points(ses.id)

        expect(points.map((item) => item.kinds)).toEqual([["read"], ["edit"], ["edit"]])
        expect(SessionRollback.filter(points, "edit").map((item) => item.step)).toEqual([2, 3])
        expect(SessionRollback.pick({ points, tool: "edit" })).toMatchObject({
          step: 3,
          partID: three.id,
          kinds: ["edit"],
        })
      },
    })
  })

  test("applies step rollback with cleanup against fresh revert state", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const usr = await user(ses.id, "inspect")
        const aid = await assistant(ses.id, usr.id)
        await step(ses.id, aid.id, "first")
        const two = await step(ses.id, aid.id, "second")

        const next = await SessionRollback.apply({
          sessionID: ses.id,
          messageID: aid.id,
          partID: two.id,
        })
        const msgs = await Session.messages({ sessionID: ses.id })
        const out = msgs.find((msg) => msg.info.id === aid.id)

        expect(next.revert).toBeUndefined()
        expect(out?.parts.map((part) => part.type)).toEqual(["step-start", "text", "step-finish"])
        expect(out?.parts.some((part) => part.id === two.id)).toBe(false)
      },
    })
  })
})
