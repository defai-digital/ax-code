import { describe, expect, test } from "bun:test"
import path from "path"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import { readSessionTransferFile } from "../../src/cli/cmd/storage/import"
import { buildTransfer, writeTransfer } from "../../src/cli/cmd/storage/transfer"
import { tmpdir } from "../fixture/fixture"

describe("storage transfer", () => {
  test("reports corrupt import files as read failures, not missing files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "corrupt.json"), "{not json")
      },
    })

    const result = await readSessionTransferFile(path.join(tmp.path, "corrupt.json"))

    expect(result.error).toStartWith("Failed to read ")
    expect(result.error).not.toContain("File not found")
  })

  test("reports schema-invalid import files before DB import starts", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "invalid-shape.json"), JSON.stringify({ info: { id: "ses_import" } }))
      },
    })

    const result = await readSessionTransferFile(path.join(tmp.path, "invalid-shape.json"))

    expect(result.error).toContain("Invalid session transfer file")
    expect(result.error).toContain("messages")
  })

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

  test("imports nested parts under their transfer message when part metadata is stale", async () => {
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
          parts: [{ type: "text", text: "preserve nested transfer parent" }],
        })

        const info = await Session.get(session.id)
        const messages = await Session.messages({ sessionID: session.id })
        const data = buildTransfer({
          info,
          messages: messages.map((msg) => ({
            info: msg.info,
            parts: msg.parts,
          })),
          events: [],
        })

        const firstMessage = data.messages[0]
        const firstTextPart = firstMessage?.parts.find((part) => part.type === "text")
        if (!firstMessage || !firstTextPart) throw new Error("expected exported text part")

        firstTextPart.messageID = "msg_stale_transfer_parent"

        await Session.remove(session.id)
        writeTransfer(data)

        const imported = await Session.messages({ sessionID: session.id })
        const importedTextPart = imported[0]?.parts.find((part) => part.id === firstTextPart.id)

        expect(String(imported[0]?.info.id)).toBe(String(firstMessage.info.id))
        expect(String(importedTextPart?.messageID)).toBe(String(firstMessage.info.id))

        await Session.remove(session.id)
      },
    })
  })
})
