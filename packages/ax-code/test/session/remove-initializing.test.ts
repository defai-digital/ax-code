import { afterEach, expect, test } from "vitest"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
})

test("archived-history maintenance can remove a session from the initializer that owns it", async () => {
  await using tmp = await tmpdir()
  await Instance.provideScoped({
    directory: tmp.path,
    init: async () => {
      const session = await Session.create({ title: "initializing history maintenance" })
      await Session.setArchived({ sessionID: session.id, time: Date.now() })
      await Session.removeArchivedGlobally(session.id)
      await expect(Session.get(session.id)).rejects.toThrow()
    },
    fn: () => undefined,
  })
  expect(Instance.list()).not.toContain(tmp.path)
})
