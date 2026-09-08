import { expect, test, vi } from "vitest"
import { DatabaseSync } from "node:sqlite"
import { setImmediate } from "node:timers/promises"
import { Session } from "../../src/session"
import { SessionID } from "../../src/session/schema"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { DurableStoragePolicy } from "../../src/storage/policy"
import { Instance } from "../../src/project/instance"
import { Bus } from "../../src/bus"
import { tmpdir } from "../fixture/fixture"

test.each([false, true])("session creation retries a real SQLite writer lock (persistent: %s)", async (persistent) => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const client = Database.Client()
      const locker = new DatabaseSync(Database.Path)
      const transaction = vi.spyOn(client, "transaction")
      const id = SessionID.descending()
      const created: SessionID[] = []
      const unsubscribe = Bus.subscribe(Session.Event.Created, (event) => {
        created.push(event.properties.info.id)
      })
      let release: ReturnType<typeof setTimeout> | undefined
      let locked = false
      try {
        client.$client.exec("PRAGMA busy_timeout = 10")
        locker.exec("BEGIN IMMEDIATE")
        locked = true
        if (!persistent)
          release = setTimeout(() => {
            locker.exec("COMMIT")
            locked = false
          }, 0)
        const create = Session.createNext({ id, directory: tmp.path })
        if (persistent) {
          await expect(create).rejects.toMatchObject({
            name: "SessionCreationBusyError",
            data: { message: expect.stringContaining("another AX Code process") },
          })
          expect(transaction).toHaveBeenCalledTimes(3)
        } else {
          expect((await create).id).toBe(id)
          expect(transaction.mock.calls.length).toBeGreaterThan(1)
        }
        await setImmediate()
        expect(created).toEqual(persistent ? [] : [id])
        const rows = client.select().from(SessionTable).where(eq(SessionTable.id, id)).all()
        expect(rows).toHaveLength(persistent ? 0 : 1)
      } finally {
        clearTimeout(release)
        if (locked) locker.exec("ROLLBACK")
        locker.close()
        client.$client.exec(`PRAGMA busy_timeout = ${DurableStoragePolicy.busyTimeoutMs}`)
        unsubscribe()
        transaction.mockRestore()
        await Instance.dispose()
      }
    },
  })
})
