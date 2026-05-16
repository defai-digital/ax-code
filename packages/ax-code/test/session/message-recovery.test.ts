import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { MessageID, PartID, type SessionID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

async function add(sessionID: SessionID, i: number) {
  const id = MessageID.ascending()
  await Session.updateMessage({
    id,
    sessionID,
    role: "user",
    time: { created: 1_000 + i },
    agent: "test",
    model: { providerID: "test" as any, modelID: "test" as any },
    tools: {},
  })
  const pid = PartID.ascending()
  await Session.updatePart({
    id: pid,
    sessionID,
    messageID: id,
    type: "text",
    text: `m${i}`,
  })
  return { id, pid }
}

describe("session message recovery", () => {
  test("skips malformed message rows without truncating older history", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Message Recovery Test" })
        const ids = [] as MessageID[]

        for (let i = 0; i < 51; i++) {
          const item = await add(session.id, i)
          ids.push(item.id)
        }

        Database.use((db) => {
          for (const id of ids.slice(1)) {
            db.update(MessageTable)
              .set({ data: { role: "user" } as any })
              .where(eq(MessageTable.id, id))
              .run()
          }
        })

        const items = await Session.messages({ sessionID: session.id })
        expect(items).toHaveLength(1)
        expect(items[0]?.info.id).toBe(ids[0])
        expect(items[0]?.parts[0]).toMatchObject({ type: "text", text: "m0" })

        await Session.remove(session.id)
      },
    })
  })

  test("skips malformed parts and still returns the parent message", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Part Recovery Test" })
        const item = await add(session.id, 0)
        const bad = PartID.ascending()

        await Session.updatePart({
          id: bad,
          sessionID: session.id,
          messageID: item.id,
          type: "text",
          text: "bad",
        })

        Database.use((db) => {
          db.update(PartTable)
            .set({ data: { type: "text" } as any })
            .where(eq(PartTable.id, bad))
            .run()
        })

        const msg = await MessageV2.get({ sessionID: session.id, messageID: item.id })
        expect(msg.info).toMatchObject({ id: item.id, role: "user" })
        expect(msg.parts).toHaveLength(1)
        expect(msg.parts[0]).toMatchObject({ id: item.pid, type: "text", text: "m0" })

        await Session.remove(session.id)
      },
    })
  })
})
