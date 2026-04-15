import { describe, expect, test } from "bun:test"
import { Auth } from "../../src/auth"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("provider routes", () => {
  test("rejects auth updates before writing when directory is invalid", async () => {
    const providerID = "provider-invalid-dir-test"
    const response = await Server.Default().request(`/auth/${providerID}?directory=relative`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "api", key: "should-not-write" }),
    })

    expect(response.status).toBe(400)
    expect(await Auth.get(providerID)).toBeUndefined()
  })

  test("updates auth routes with request directory context", async () => {
    await using tmp = await tmpdir({ git: true })
    const directory = encodeURIComponent(tmp.path)
    const app = Server.Default()

    const put = await app.request(`/auth/xai?directory=${directory}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "api", key: "test-key" }),
    })
    const del = await app.request(`/auth/xai?directory=${directory}`, {
      method: "DELETE",
    })

    expect(put.status).toBe(200)
    expect(await put.json()).toBe(true)
    expect(del.status).toBe(200)
    expect(await del.json()).toBe(true)
  })

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
