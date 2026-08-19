import { describe, expect, test } from "vitest"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionGoal } from "../../src/session/goal"
import { MessageV2 } from "../../src/session/message-v2"
import { MessageID, PartID } from "../../src/session/schema"
import { Database, eq } from "../../src/storage/db"
import { MessageTable, PartTable } from "../../src/session/session.sql"

function userMessage(sessionID: string): MessageV2.Info {
  return {
    id: MessageID.ascending(),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "test", modelID: "test" },
  } as unknown as MessageV2.Info
}

describe("session.fork batching", () => {
  test("forks >250 messages across chunked commits without dropping rows", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const source = await Session.create({})
        const MESSAGE_COUNT = 251
        for (let i = 0; i < MESSAGE_COUNT; i++) {
          await Session.updateMessage(userMessage(source.id))
        }

        const fork = await Session.fork({ sessionID: source.id })

        const rows = Database.use((db) =>
          db.select().from(MessageTable).where(eq(MessageTable.session_id, fork.id)).all(),
        )
        expect(rows).toHaveLength(MESSAGE_COUNT)
        expect(rows.every((row) => row.session_id === fork.id)).toBe(true)
      },
    })
  })
})

describe("session.updateParts batching", () => {
  test("persists >500 parts split across chunked commits", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        const messageID = MessageID.ascending()
        await Session.updateMessage({
          ...userMessage(session.id),
          id: messageID,
        } as unknown as MessageV2.Info)

        const PART_COUNT = 501
        const parts = Array.from(
          { length: PART_COUNT },
          () =>
            ({
              id: PartID.ascending(),
              messageID,
              sessionID: session.id,
              type: "text",
              text: "part",
            }) as unknown as MessageV2.Part,
        )

        await Session.updateParts(parts)

        const rows = Database.use((db) => db.select().from(PartTable).where(eq(PartTable.message_id, messageID)).all())
        expect(rows).toHaveLength(PART_COUNT)
      },
    })
  })
})

describe("SessionGoal.addUsage write reduction", () => {
  test("zero-token sub-second turns skip the goal write", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({})
        await SessionGoal.create({ sessionID: session.id, objective: "no-op turn", tokenBudget: 100 })
        const before = await SessionGoal.get(session.id)

        // Ensure any write would land on a later millisecond than creation, so
        // a regression that reintroduces the no-op UPDATE is observable.
        await new Promise((resolve) => setTimeout(resolve, 5))

        const updated = await SessionGoal.addUsage({
          sessionID: session.id,
          message: {
            id: "message_goal_noop" as any,
            sessionID: session.id,
            parentID: "message_parent" as any,
            role: "assistant",
            time: { created: 1_000, completed: 1_200 },
            modelID: "test" as any,
            providerID: "test" as any,
            mode: "build",
            agent: "build",
            path: { cwd: tmp.path, root: tmp.path },
            tokens: { total: 0, input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          },
        })

        expect(updated?.tokensUsed).toBe(0)
        expect(updated?.status).toBe("active")
        // The row was read, not written: time_updated is unchanged.
        expect(updated?.time.updated).toBe(before?.time.updated)
      },
    })
  })
})
