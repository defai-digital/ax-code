import { describe, expect, test } from "bun:test"
import path from "path"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Recorder } from "../../src/replay/recorder"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
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

describe("session rollback endpoint", () => {
  test("returns rollback points with step metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const usr = await user(ses.id, "inspect")
        const aid = await assistant(ses.id, usr.id, tmp.path)
        const one = await step(ses.id, aid.id, "first")
        const two = await step(ses.id, aid.id, "second")
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
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 2 })
        Recorder.emit({
          type: "step.finish",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 2,
          finishReason: "stop",
          tokens: { input: 5, output: 2 },
        })
        Recorder.end(ses.id)
        await new Promise((done) => setTimeout(done, 50))

        const app = Server.Default()
        const res = await app.request(`/session/${ses.id}/rollback`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionRollback.Point[]
        expect(body).toHaveLength(2)
        expect(body[0]?.step).toBe(1)
        expect(body[0]?.messageID).toBe(aid.id)
        expect(body[0]?.partID).toBe(one.id)
        expect(body[0]?.tokens).toEqual({ input: 8, output: 4 })
        expect(body[0]?.tools).toEqual(["read: demo.ts"])
        expect(body[0]?.kinds).toEqual(["read"])
        expect(body[1]?.step).toBe(2)
        expect(body[1]?.partID).toBe(two.id)
      },
    })
  })

  test("filters rollback points by tool query", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const ses = await Session.create({})
        const usr = await user(ses.id, "inspect")
        const aid = await assistant(ses.id, usr.id, tmp.path)
        await step(ses.id, aid.id, "first")
        const two = await step(ses.id, aid.id, "second")
        const read = path.join(tmp.path, "src/read.ts")
        const edit = path.join(tmp.path, "src/edit.ts")

        Recorder.begin(ses.id)
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 1 })
        Recorder.emit({
          type: "tool.call",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 1,
          tool: "read",
          callID: "read-1",
          input: { filePath: read },
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 1,
          finishReason: "stop",
          tokens: { input: 8, output: 4 },
        })
        Recorder.emit({ type: "step.start", sessionID: ses.id, messageID: aid.id, stepIndex: 2 })
        Recorder.emit({
          type: "tool.call",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 2,
          tool: "edit",
          callID: "edit-1",
          input: { filePath: edit },
        })
        Recorder.emit({
          type: "step.finish",
          sessionID: ses.id,
          messageID: aid.id,
          stepIndex: 2,
          finishReason: "stop",
          tokens: { input: 5, output: 2 },
        })
        Recorder.end(ses.id)
        await new Promise((done) => setTimeout(done, 50))

        const app = Server.Default()
        const res = await app.request(`/session/${ses.id}/rollback?tool=edit`)

        expect(res.status).toBe(200)
        const body = (await res.json()) as SessionRollback.Point[]
        expect(body).toHaveLength(1)
        expect(body[0]?.step).toBe(2)
        expect(body[0]?.partID).toBe(two.id)
        expect(body[0]?.kinds).toEqual(["edit"])
      },
    })
  })

  test("returns 404 for a missing session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.Default()
        const res = await app.request("/session/ses_missing/rollback")
        expect(res.status).toBe(404)
      },
    })
  })
})
