import { describe, expect, test } from "vitest"
import path from "path"
import { eq } from "drizzle-orm"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { MessageID } from "../../src/session/schema"
import { Database } from "../../src/storage/db"
import { Log } from "../../src/util/log"

const projectRoot = path.join(__dirname, "../..")
Log.init({ print: false })

describe("session last recap", () => {
  test("persists the recap without bumping time_updated", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        try {
          const recap = {
            text: "Added the durable recap and reran the focused tests.",
            time: 1_790_000_000_000,
            scope: "turn" as const,
          }
          const updated = await Session.setLastRecap({ sessionID: session.id, recap })
          expect(updated.lastRecap).toEqual(recap)
          // A display hint must not reorder the session list.
          expect(updated.time.updated).toBe(session.time.updated)

          const reloaded = await Session.get(session.id)
          expect(reloaded.lastRecap).toEqual(recap)
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("clears the stored recap on revert", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        try {
          await Session.setLastRecap({
            sessionID: session.id,
            recap: { text: "Implemented search.", time: 1, scope: "turn" },
          })

          const reverted = await Session.setRevert({
            sessionID: session.id,
            revert: { messageID: MessageID.make("msg_last_recap_revert") },
            summary: undefined,
          })
          expect(reverted.lastRecap).toBeUndefined()
          expect((await Session.get(session.id)).lastRecap).toBeUndefined()
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("drops a corrupt recap payload instead of hiding the session", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        try {
          Database.use((db) =>
            db
              .update(SessionTable)
              .set({ last_recap: { text: 42 } as never })
              .where(eq(SessionTable.id, session.id))
              .run(),
          )

          const reloaded = await Session.get(session.id)
          expect(reloaded.id).toBe(session.id)
          expect(reloaded.lastRecap).toBeUndefined()
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })

  test("rejects a recap text longer than the storage bound", async () => {
    await Instance.provide({
      directory: projectRoot,
      fn: async () => {
        const session = await Session.create({})
        try {
          expect(() =>
            Session.setLastRecap({
              sessionID: session.id,
              recap: { text: "x".repeat(Session.LAST_RECAP_MAX_CHARS + 1), time: 1, scope: "turn" },
            }),
          ).toThrow()
        } finally {
          await Session.remove(session.id)
        }
      },
    })
  })
})
