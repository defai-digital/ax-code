import { afterEach, describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

describe("project identity", () => {
  test("keeps non-git directories in separate project buckets", async () => {
    await using first = await tmpdir()
    await using second = await tmpdir()

    const firstSession = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ title: "first non-git" }),
    })
    const secondSession = await Instance.provide({
      directory: second.path,
      fn: async () => Session.create({ title: "second non-git" }),
    })

    expect(firstSession.projectID).not.toBe("global")
    expect(secondSession.projectID).not.toBe("global")
    expect(firstSession.projectID).not.toBe(secondSession.projectID)
  })

  test("rejects explicit session reads from a different current project", async () => {
    await using first = await tmpdir({ git: true })
    await using second = await tmpdir({ git: true })
    const app = Server.Default()

    const session = await Instance.provide({
      directory: first.path,
      fn: async () => Session.create({ title: "first project session" }),
    })

    const response = await app.request(`/session/${session.id}`, {
      headers: {
        "x-opencode-directory": second.path,
      },
    })

    expect(response.status).toBe(409)
  })
})
