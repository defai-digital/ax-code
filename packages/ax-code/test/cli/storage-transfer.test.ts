import { ProviderID, ModelID } from "../../src/provider/schema"
import { afterEach, describe, expect, test, vi, type MockInstance } from "vitest"
import path from "path"
import { writeFile } from "node:fs/promises"
import { EventQuery } from "../../src/replay/query"
import { Recorder } from "../../src/replay/recorder"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionShard } from "../../src/session/shard"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { SessionPrompt } from "../../src/session/prompt"
import { Database, eq } from "../../src/storage/db"
import { Filesystem } from "../../src/util/filesystem"
import { readSessionTransferFile } from "../../src/cli/cmd/storage/import"
import { buildTransfer, writeTransfer } from "../../src/cli/cmd/storage/transfer"
import { tmpdir } from "../fixture/fixture"

let readJsonSpy: MockInstance | undefined

afterEach(() => {
  readJsonSpy?.mockRestore()
  readJsonSpy = undefined
})

describe("storage transfer", () => {
  test("reports corrupt import files as read failures, not missing files", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "corrupt.json"), "{not json")
      },
    })

    const result = await readSessionTransferFile(path.join(tmp.path, "corrupt.json"))

    expect(result.error).toMatch(/^Failed to read /)
    expect(result.error).not.toContain("File not found")
  })

  test("reports unprintable import read failures", async () => {
    const failure = {
      toString() {
        throw new Error("cannot print")
      },
    }
    readJsonSpy = vi.spyOn(Filesystem, "readJson").mockImplementation(async () => {
      throw failure
    })

    const result = await readSessionTransferFile("/tmp/session-export.json")

    expect(result.error).toBe("Failed to read /tmp/session-export.json: Unknown error")
  })

  test("reports schema-invalid import files before DB import starts", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await writeFile(path.join(dir, "invalid-shape.json"), JSON.stringify({ info: { id: "ses_import" } }))
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
            model: "openai/gpt-5.4",
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
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") },
          parts: [{ type: "text", text: "build a dashboard app" }],
        })

        Recorder.begin(session.id)
        await SessionPrompt.prompt({
          sessionID: session.id,
          agent: "build",
          noReply: true,
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") },
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
            model: "openai/gpt-5.4",
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
          model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") },
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

  test("imports a transfer into the active session shard and rolls back a corrupt one", async () => {
    const previousShardSessions = process.env.AX_CODE_SHARD_SESSIONS
    process.env.AX_CODE_SHARD_SESSIONS = "1"
    try {
      await using tmp = await tmpdir({
        git: true,
        config: {
          // This host cannot resolve os.userInfo() (uv_os_get_passwd ENOENT);
          // an explicit username short-circuits config-impl.ts's fallback.
          username: "test",
          agent: {
            build: {
              model: "openai/gpt-5.4",
            },
          },
        },
      })

      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const text = "import this transcript into the active shard"
          const session = await Session.create({})

          await SessionPrompt.prompt({
            sessionID: session.id,
            agent: "build",
            noReply: true,
            model: { providerID: ProviderID.make("openai"), modelID: ModelID.make("gpt-5.4") },
            parts: [{ type: "text", text }],
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

          await Session.remove(session.id)
          writeTransfer(data)

          // Reads route through the active shard, so an import that only writes
          // the registry silently disappears from the visible transcript.
          const imported = await Session.messages({ sessionID: session.id })
          expect(imported.flatMap((msg) => msg.parts).find((part) => part.type === "text")?.text).toBe(text)

          const projectID = Instance.project.id
          const shardMessages = SessionShard.storeForProject(projectID).use((db) =>
            db.select().from(MessageTable).where(eq(MessageTable.session_id, session.id)).all(),
          )
          const shardParts = SessionShard.storeForProject(projectID).use((db) =>
            db.select().from(PartTable).where(eq(PartTable.session_id, session.id)).all(),
          )
          expect(shardMessages.length).toBeGreaterThan(0)
          expect(shardParts.length).toBeGreaterThan(0)

          const registryMessages = Database.use((db) =>
            db.select().from(MessageTable).where(eq(MessageTable.session_id, session.id)).all(),
          )
          const registryParts = Database.use((db) =>
            db.select().from(PartTable).where(eq(PartTable.session_id, session.id)).all(),
          )
          expect(registryMessages).toHaveLength(0)
          expect(registryParts).toHaveLength(0)

          await Session.remove(session.id)

          // A corrupt part must abort the whole import: the session metadata
          // inserted earlier in the same transaction has to roll back, and the
          // shard must not keep a half-imported message.
          const textPart = data.messages[0]?.parts.find((part) => part.type === "text")
          if (!textPart) throw new Error("expected transfer text part")
          Object.assign(textPart, { type: "corrupted-text" })

          expect(() => writeTransfer(data)).toThrow()
          await expect(Session.get(session.id)).rejects.toThrow()

          const leftoverMessages = SessionShard.storeForProject(projectID).use((db) =>
            db.select().from(MessageTable).where(eq(MessageTable.session_id, session.id)).all(),
          )
          const leftoverParts = SessionShard.storeForProject(projectID).use((db) =>
            db.select().from(PartTable).where(eq(PartTable.session_id, session.id)).all(),
          )
          expect(leftoverMessages).toHaveLength(0)
          expect(leftoverParts).toHaveLength(0)
        },
      })
    } finally {
      if (previousShardSessions === undefined) delete process.env.AX_CODE_SHARD_SESSIONS
      else process.env.AX_CODE_SHARD_SESSIONS = previousShardSessions
    }
  })
})
