import { describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "../../src/global"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("session diff recovery", () => {
  test("returns empty diff and self-heals corrupted session_diff storage", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ title: "Diff Recovery Test" })
        const file = path.join(Global.Path.data, "storage", "session_diff", `${session.id}.json`)

        await Bun.write(file, "{ invalid json")

        const diff = await Session.diff(session.id)
        expect(diff).toEqual([])

        const healed = await Filesystem.readText(file)
        expect(healed.trim()).toBe("[]")

        await Session.remove(session.id)
      },
    })
  })
})
