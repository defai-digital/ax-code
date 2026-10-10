import { afterEach, beforeAll, afterAll, expect, test } from "vitest"

const previousShardSessions = process.env.AX_CODE_SHARD_SESSIONS
beforeAll(() => {
  process.env.AX_CODE_SHARD_SESSIONS = "1"
})
afterAll(() => {
  if (previousShardSessions === undefined) delete process.env.AX_CODE_SHARD_SESSIONS
  else process.env.AX_CODE_SHARD_SESSIONS = previousShardSessions
})

import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionShard } from "../../src/session/shard"
import { MessageTable, PartTable } from "../../src/session/session.sql"
import { eq } from "../../src/storage/db"
import { MessageID, PartID } from "../../src/session/schema"
import type { MessageV2 } from "../../src/session/message-v2"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("removeMessage deletes the message's parts in a shard store without a cascading foreign key", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const messageID = MessageID.ascending()
      await Session.updateMessage({
        id: messageID,
        sessionID: session.id,
        role: "user",
        time: { created: Date.now() },
        agent: "build",
        model: { providerID: "test", modelID: "test" },
      } as MessageV2.User)
      await Session.updatePart({
        id: PartID.ascending(),
        messageID,
        sessionID: session.id,
        type: "text",
        text: "hello",
      } as MessageV2.TextPart)
      const store = SessionShard.storeFor(session.id)
      const parts = () =>
        store.use((db) => db.select().from(PartTable).where(eq(PartTable.message_id, messageID)).all())
      expect(parts()).toHaveLength(1)

      await Session.removeMessage({ sessionID: session.id, messageID })

      expect(store.use((db) => db.select().from(MessageTable).where(eq(MessageTable.id, messageID)).all())).toEqual([])
      expect(parts()).toEqual([])
    },
  })
})
