import { describe, expect, test } from "bun:test"
import { eq } from "drizzle-orm"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
import { tmpdir } from "../fixture/fixture"

function breakRow(id: string) {
  Database.use((db) => {
    db.update(SessionTable).set({ permission: { nope: true } as any }).where(eq(SessionTable.id, id as any)).run()
  })
}

describe("session row recovery", () => {
  test("treats malformed session rows as missing in get", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Bad Session Get" })
        breakRow(session.id)
        await expect(Session.get(session.id)).rejects.toMatchObject({ name: "NotFoundError" })
      },
    })
  })

  test("skips malformed session rows in list", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const good = await Session.create({ title: "good-list-session" })
        const bad = await Session.create({ title: "bad-list-session" })
        breakRow(bad.id)

        const items = [...Session.list({ limit: 100 })]
        const ids = items.map((item) => item.id)

        expect(ids).toContain(good.id)
        expect(ids).not.toContain(bad.id)

        await Session.remove(good.id)
      },
    })
  })

  test("skips malformed session rows in listGlobal", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })

    const good = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ title: "good-global-session" }),
    })
    const bad = await Instance.provide({
      directory: second.path,
      fn: async () => Session.create({ title: "bad-global-session" }),
    })

    breakRow(bad.id)

    const items = [...Session.listGlobal({ limit: 200, archived: true })]
    const ids = items.map((item) => item.id)

    expect(ids).toContain(good.id)
    expect(ids).not.toContain(bad.id)

    await Instance.provide({
      directory: first.path,
      fn: async () => {
        await Session.remove(good.id)
      },
    })
  })
})
