import { describe, expect, test } from "bun:test"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { buildTransfer, writeTransfer } from "../../src/cli/cmd/storage/transfer"
import { tmpdir } from "../fixture/fixture"

describe("storage transfer", () => {
  test("exports and reimports replay events with the session payload", async () => {
    await using tmp = await tmpdir({
      git: true,
      config: {
        agent: {
          build: {
            model: "openai/gpt-5.2",
          },
        },
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})

        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "build a dashboard app" }],
        })

        Recorder.begin(session.id)
        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "profile the dashboard performance and find the bottleneck" }],
        })
        Recorder.end(session.id)
        await new Promise((r) => setTimeout(r, 50))

        const info = await Session.get(session.id)
        const messages = await Session.messages({ sessionID: session.id })
        const events = EventQuery.bySessionLog(session.id)
        const data = buildTransfer({
          info,
          messages: messages.map((msg) => ({
            info: msg.info,
            parts: msg.parts,
          })),
          events,
        })

        const exportedRoute = data.events?.map((item) => item.event).findLast((event) => event.type === "agent.route")
        if (!exportedRoute || exportedRoute.type !== "agent.route") {
          throw new Error("expected exported agent.route")
        }

        await Session.remove(session.id)
        writeTransfer(data)

        const imported = EventQuery.bySessionAndType(session.id, "agent.route").at(-1)
        if (!imported || imported.type !== "agent.route") throw new Error("expected agent.route")
        expect(imported.messageID).toBeDefined()
        expect(imported.toAgent).toBe("perf")
        expect(imported.routeMode).toBe(exportedRoute.routeMode)

        EventQuery.deleteBySession(session.id)
        await Session.remove(session.id)
      },
    })
  })
})
