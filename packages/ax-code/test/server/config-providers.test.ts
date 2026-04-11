import { afterEach, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const key = "XAI_API_KEY"

afterEach(async () => {
  delete process.env[key]
  await Instance.disposeAll()
  await resetDatabase()
})

test("config providers route does not expose provider keys", async () => {
  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "ax-code.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })
  process.env[key] = "secret-key"
  const app = Server.Default()
  const res = await app.request("/config/providers", {
    headers: {
      "x-opencode-directory": tmp.path,
    },
  })
  expect(res.status).toBe(200)
  const body = await res.json()
  const provider = body.providers.find((item: { id: string }) => item.id === "xai")
  expect(provider).toBeDefined()
  expect("key" in provider).toBe(false)
})

