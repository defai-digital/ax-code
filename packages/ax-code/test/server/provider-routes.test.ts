import { describe, expect, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("provider routes", () => {
  test("shows x.ai and z.ai providers on fresh config", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const response = await Server.Default().request("/provider")
        expect(response.status).toBe(200)

        const body = (await response.json()) as { all: Array<{ id: string }> }
        const ids = body.all.map((provider) => provider.id)
        expect(ids).toContain("xai")
        expect(ids).toContain("zai")
        expect(ids).toContain("zai-coding-plan")
      },
    })
  })
})
