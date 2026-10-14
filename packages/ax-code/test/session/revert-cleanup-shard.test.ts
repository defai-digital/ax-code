import { afterEach, afterAll, beforeAll, expect, test } from "vitest"

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
import { SessionRevert } from "../../src/session/revert"
import { SessionShard } from "../../src/session/shard"
import { PartTable } from "../../src/session/session.sql"
import type { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("revert cleanup deletes the parts of whole removed messages in a shard store", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({})
      const ids = [MessageID.ascending(), MessageID.ascending()]
      for (const id of ids) {
        await Session.updateMessage({
          id,
          sessionID: session.id,
          role: "user",
          agent: "build",
          model: { providerID: "test", modelID: "test" },
          time: { created: Date.now() },
        } as MessageV2.User)
        await Session.updatePart({
          id: PartID.ascending(),
          messageID: id,
          sessionID: session.id,
          type: "text",
          text: "body",
        } as MessageV2.TextPart)
      }

      const store = SessionShard.storeFor(session.id)
      expect(store.use((db) => db.select().from(PartTable).all())).toHaveLength(2)

      await Session.setRevert({ sessionID: session.id, revert: { messageID: ids[0] }, summary: undefined })
      await SessionRevert.cleanup(await Session.get(session.id))

      expect(await Session.messages({ sessionID: session.id })).toEqual([])
      expect(store.use((db) => db.select().from(PartTable).all())).toEqual([])
    },
  })
})
