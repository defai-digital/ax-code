import { expect, test } from "vitest"
import { Session } from "../../src/session"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { SessionTable } from "../../src/session/session.sql"
import { tmpdir } from "../fixture/fixture"

test("reject invalid prune ttl inputs", () => {
  expect(Session.validatePruneTtlDays(1)).toBe(1)
  expect(Session.validatePruneTtlDays(30)).toBe(30)

  for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "30", undefined]) {
    expect(() => Session.validatePruneTtlDays(value)).toThrow("Session prune ttlDays must be a positive integer")
  }
})

test("does not cascade-prune a fresh descendant through an expired parent", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({ title: "Expired parent" })
      const child = await Session.create({ parentID: parent.id, title: "Fresh child" })
      const expired = Date.now() - 2 * 24 * 60 * 60 * 1000

      Database.use((db) =>
        db.update(SessionTable).set({ time_updated: expired }).where(eq(SessionTable.id, parent.id)).run(),
      )

      try {
        expect(await Session.pruneExpired(1)).toBe(0)
        expect((await Session.get(parent.id)).id).toBe(parent.id)
        expect((await Session.get(child.id)).id).toBe(child.id)
      } finally {
        await Session.remove(parent.id).catch(() => undefined)
      }
    },
  })
})

test("counts and removes every session in a fully expired tree", async () => {
  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const parent = await Session.create({ title: "Expired parent" })
      const child = await Session.create({ parentID: parent.id, title: "Expired child" })
      const expired = Date.now() - 2 * 24 * 60 * 60 * 1000

      Database.use((db) =>
        db
          .update(SessionTable)
          .set({ time_updated: expired })
          .where(eq(SessionTable.project_id, parent.projectID))
          .run(),
      )

      expect(await Session.pruneExpired(1)).toBe(2)
      await expect(Session.get(parent.id)).rejects.toThrow()
      await expect(Session.get(child.id)).rejects.toThrow()
    },
  })
})
