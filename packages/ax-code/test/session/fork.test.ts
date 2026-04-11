import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { tmpdir } from "../fixture/fixture"

describe("session fork", () => {
  test("persists parent linkage and exposes forked children", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ title: "root" })
        const fork = await Session.fork({ sessionID: root.id })
        const next = await Session.get(fork.id)
        const kids = await Session.children(root.id)

        expect(next.parentID).toBe(root.id)
        expect(kids.map((item) => item.id)).toContain(fork.id)
      },
    })
  })
})
